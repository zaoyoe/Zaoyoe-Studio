// ==========================================
// Admin Studio - Shop Management Module
// ==========================================

let SHOP_ADMIN_RUNTIME_CONFIG = null;
try {
    SHOP_ADMIN_RUNTIME_CONFIG = typeof window.requireZaoyoeSupabaseConfig === 'function'
        ? window.requireZaoyoeSupabaseConfig()
        : null;
} catch (error) {
    console.error('Failed to resolve shop admin Supabase runtime config:', error);
}
const SHOP_ADMIN_PROJECT_URL = String(SHOP_ADMIN_RUNTIME_CONFIG?.url || '').trim();
const SHOP_ADMIN_PUBLISHABLE_KEY = String(SHOP_ADMIN_RUNTIME_CONFIG?.publishableKey || '').trim();

// Keep auth on the custom domain client, but route shop data reads/writes
// through the official project endpoint to avoid PATCH/DELETE fetch failures.
const supabaseClient = (() => {
    const authClient = window.supabaseClient;

    if (!authClient || typeof window.supabase?.createClient !== 'function') {
        return authClient;
    }

    if (!SHOP_ADMIN_PROJECT_URL || !SHOP_ADMIN_PUBLISHABLE_KEY) {
        console.error('Shop admin runtime Supabase config is unavailable.');
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
                if (window.AdminApi?.getAccessToken) {
                    const accessToken = await window.AdminApi.getAccessToken();
                    return accessToken || null;
                }

                const sessionResult = await Promise.race([
                    authClient.auth.getSession(),
                    new Promise((resolve) => {
                        window.setTimeout(() => resolve(null), 4000);
                    })
                ]);
                const session = sessionResult?.data?.session || null;
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
    SHOP_TAB_IDS: ['products', 'import', 'inventory', 'orders', 'fulfillment'],
    shopTabLoadState: Object.create(null),
    shopTabLoadPromiseMap: Object.create(null),
    shopTabLoadGeneration: Object.create(null),
    shopTabPrefetchHandle: 0,
    shopTabPrefetchMode: '',
    shopTabPrefetchGeneration: 0,
    shopContextListenersBound: false,
    shopSiteChangeRequestId: 0,
    selectedProductId: null,
    inventoryPage: 1,
    ordersPage: 1,
    focusedOrderId: '',
    currentOrderDetailId: '',
    orderDetailRequestToken: 0,
    pendingOpenOrderDetails: false,
    orderSearchRequestToken: 0,
    orderSearchContext: null,
    currentOrderRows: [],
    orderRefundStatusFilter: 'all',
    orderDeliveryStatusFilter: 'all',
    deliveryTaskPage: 1,
    deliveryTaskStatusFilter: 'all',
    deliveryTaskQuery: '',
    deliveryTaskQueryContext: null,
    deliveryWorkbenchContext: null,
    deliveryConflictBucketFilter: null,
    deliveryTaskIdentityFilter: null,
    deliveryConflictAuditSelection: null,
    deliveryConflictAuditRecords: [],
    deliveryConflictAuditReasonFilter: 'all',
    deliveryConflictAuditTargetFilter: '',
    deliveryConflictAuditChannelFilter: '',
    deliveryMockModeEnabled: false,
    deliveryMockStore: null,
    deliveryRestoreLinkFeedback: null,
    deliveryRestoreLinkFeedbackTimer: null,
    deliveryPendingTaskReveal: null,
    deliveryPendingAuditReveal: null,
    deliveryPendingSectionReveal: '',
    deliveryTaskPageSize: 8,
    deliveryDeadLetterPage: 1,
    deliveryDeadLetterReasonFilter: 'all',
    deliveryDeadLetterPageSize: 5,
    deliveryLockConflictPage: 1,
    deliveryLockStateFilter: 'all',
    deliveryLockConflictPageSize: 5,
    deliveryReplayPage: 1,
    deliveryReplayPageSize: 5,
    deliveryAnalyticsWindow: '24h',
    deliveryStrategyConfig: null,
    pageSize: 10,
    currentCategory: 'all', // State for category filter
    currentStatusFilter: 'active', // State for status filter: 'active' or 'deleted'
    productSearchQuery: '',
    currentProductDeliveryFilter: 'all',
    currentImportCategory: 'all', // State for import filter
    allProductsForImport: [], // Cache for import list (active products)
    deletedProductsForImport: [], // Cache for deleted products (recycle bin)
    isProductSelectionMode: false, // State for product multi-select mode
    delegatedHandlersBound: false,
    editingProductSnapshot: null, // Original product row for resilient saves on existing items
    purchaseNotesSchemaAvailable: null, // null = unknown, false = remote DB not migrated yet
    richTextEditorsReady: false,
    shopCustomSelectBridgeReady: false,

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

    requireWritableSite(options = {}) {
        return window.AdminSiteFilter?.requireWritableSite?.(options) || null;
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
            hint.classList.add('shop-product-site-hint--visible');
            hint.innerHTML = filter === 'all'
                ? '⚠️ 当前为“全部”模式，默认编辑 <strong>CN</strong> 商品信息。切换站点可编辑对应站点的名称/价格/描述。'
                : (isCN
                    ? '🇨🇳 正在编辑 <strong>CN</strong> 商品信息'
                    : '🌍 Editing <strong>EN</strong> product info');
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
        if (!wrapper.classList.contains('shop-form-section--expanded')) return;
        wrapper.classList.add('shop-form-section--expanded');
    },

    setOptionalInputValue: function (inputId, value) {
        const input = document.getElementById(inputId);
        if (input) {
            input.value = value;
        }
    },

    // Translate Chinese text to English using Gemini API
    translateToEnglish: async function (name, description) {
        if (!window.AdminAI?.configured) {
            console.warn('[ShopAdmin] No server AI proxy, skipping translation');
            return { name_en: null, description_en: null };
        }

        const prompt = `Translate the following Chinese product information to English. Return ONLY a JSON object with "name" and "description" fields, no markdown or extra text.

Product Name: ${name}
Description: ${description || 'N/A'}

Example output format:
{"name": "English Name", "description": "English description"}`;

        try {
            const text = await window.AdminAI.generateText(prompt, {
                model: 'gemini-2.0-flash',
                generationConfig: { temperature: 0.1, maxOutputTokens: 500 }
            });

            // Parse JSON from response
            const jsonMatch = (text || '').match(/\{[\s\S]*?\}/);
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

    getAdminAuthHeaders: async function () {
        if (window.AdminAI?.getAuthHeaders) {
            return window.AdminAI.getAuthHeaders();
        }

        const { data: { session } = {} } = await window.supabaseClient.auth.getSession();
        return {
            'Content-Type': 'application/json',
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
        };
    },

    buildAdminRouteUrl: function (route, params = {}) {
        const normalizedRoute = String(route || '').trim().replace(/^\/+|\/+$/g, '');
        const url = new URL('/api/admin', window.location.origin);
        if (normalizedRoute) {
            url.searchParams.set('route', normalizedRoute);
        }
        Object.entries(params || {}).forEach(([key, value]) => {
            if (value === undefined || value === null || value === '') {
                return;
            }
            url.searchParams.set(key, String(value));
        });
        return `${url.pathname}${url.search}`;
    },

    buildAdminShopUrl: function (route, params = {}) {
        return this.buildAdminRouteUrl(route, params);
    },

    callAdminMutation: async function (action, payload = {}) {
        const headers = await this.getAdminAuthHeaders();
        const response = await fetch(this.buildAdminShopUrl('shop/mutate'), {
            method: 'POST',
            headers,
            body: JSON.stringify({
                action,
                site: window.AdminSiteFilter?.getSiteFilter?.() || 'all',
                ...payload
            })
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.success) {
            throw new Error(result.message || '管理员接口调用失败');
        }

        this.invalidateShopTabCache();
        return result;
    },

    getInventoryQueryFilters: function ({ page = 1, pageSize = this.pageSize, includeSearch = true } = {}) {
        const productId = document.getElementById('invFilterProduct')?.value || null;
        const status = document.getElementById('invFilterStatus')?.value || null;
        const search = includeSearch ? (document.getElementById('invSearchInput')?.value || null) : null;
        const dateType = document.getElementById('invFilterDateType')?.value || 'all';

        let dateFrom = null;
        let dateTo = null;

        if (dateType === 'custom') {
            const fromValue = document.getElementById('invDateFrom')?.value;
            const toValue = document.getElementById('invDateTo')?.value;
            if (fromValue) dateFrom = `${fromValue} 00:00:00`;
            if (toValue) dateTo = `${toValue} 23:59:59`;
        } else if (dateType !== 'all') {
            const now = new Date();
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

            if (dateType === 'today') {
                dateFrom = todayStart.toISOString();
                const todayEnd = new Date(todayStart);
                todayEnd.setHours(23, 59, 59, 999);
                dateTo = todayEnd.toISOString();
            } else if (dateType === 'week') {
                const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                dateFrom = weekAgo.toISOString();
                dateTo = now.toISOString();
            } else if (dateType === 'month') {
                const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                dateFrom = monthAgo.toISOString();
                dateTo = now.toISOString();
            }
        }

        return {
            page,
            pageSize,
            productId,
            status,
            search,
            dateFrom,
            dateTo
        };
    },

    loadInventoryViaAdminApi: async function (params = {}) {
        const response = await (window.AdminApi?.fetch || fetch)(
            this.buildAdminShopUrl('shop/inventory', params),
            { credentials: 'include' }
        );
        const payload = await response.json().catch(() => ({}));

        if (!response.ok || !payload.success) {
            throw new Error(payload.message || '库存列表加载失败');
        }

        return payload;
    },

    loadShopProductsViaAdminApi: async function (params = {}) {
        const response = await (window.AdminApi?.fetch || fetch)(
            this.buildAdminShopUrl('shop/products', params),
            { credentials: 'include' }
        );
        const payload = await response.json().catch(() => ({}));

        if (!response.ok || !payload.success) {
            throw new Error(payload.message || '商品列表加载失败');
        }

        return payload;
    },

    loadShopProductByIdViaAdminApi: async function (productId) {
        const normalizedId = String(productId || '').trim();
        if (!normalizedId) {
            throw new Error('缺少商品 ID');
        }

        const response = await (window.AdminApi?.fetch || fetch)(
            this.buildAdminShopUrl('shop/products', { id: normalizedId }),
            { credentials: 'include' }
        );
        const payload = await response.json().catch(() => ({}));

        if (!response.ok || !payload.success) {
            throw new Error(payload.message || '商品详情加载失败');
        }

        return payload;
    },

    loadShopCategoriesViaAdminApi: async function () {
        const response = await (window.AdminApi?.fetch || fetch)(
            this.buildAdminShopUrl('shop/categories'),
            { credentials: 'include' }
        );
        const payload = await response.json().catch(() => ({}));

        if (!response.ok || !payload.success) {
            throw new Error(payload.message || '分类列表加载失败');
        }

        return payload;
    },

    loadInventoryDetailViaAdminApi: async function (inventoryId) {
        const normalizedId = String(inventoryId || '').trim();
        if (!normalizedId) {
            throw new Error('缺少库存 ID');
        }

        const response = await (window.AdminApi?.fetch || fetch)(
            this.buildAdminShopUrl('shop/inventory-detail', { id: normalizedId }),
            { credentials: 'include' }
        );
        const payload = await response.json().catch(() => ({}));

        if (!response.ok || !payload.success) {
            throw new Error(payload.message || '库存详情加载失败');
        }

        return payload;
    },

    loadOrdersViaAdminApi: async function (params = {}) {
        const response = await (window.AdminApi?.fetch || fetch)(
            this.buildAdminShopUrl('shop/orders', params),
            { credentials: 'include' }
        );
        const payload = await response.json().catch(() => ({}));

        if (!response.ok || !payload.success) {
            throw new Error(payload.message || '订单列表加载失败');
        }

        return payload;
    },

    loadOrderDetailViaAdminApi: async function (orderId) {
        const normalizedId = String(orderId || '').trim();
        if (!normalizedId) {
            throw new Error('缺少订单 ID');
        }

        const response = await (window.AdminApi?.fetch || fetch)(
            this.buildAdminShopUrl('shop/order-detail', { id: normalizedId }),
            { credentials: 'include' }
        );
        const payload = await response.json().catch(() => ({}));

        if (!response.ok || !payload.success) {
            throw new Error(payload.message || '订单详情加载失败');
        }

        return payload;
    },

    loadAllOrdersForExport: async function ({ site = 'all', pageSize = 100, query = '', refundStatus = 'all', deliveryStatus = 'all' } = {}) {
        const collectedRows = [];
        let page = 1;
        let total = null;

        while (page <= 100) {
            const payload = await this.loadOrdersViaAdminApi({
                site,
                page,
                pageSize,
                query: String(query || '').trim() || null,
                refundStatus,
                deliveryStatus
            });
            const rows = Array.isArray(payload?.rows) ? payload.rows : [];
            const count = Number(payload?.count);

            if (Number.isFinite(count) && count >= 0) {
                total = count;
            }

            collectedRows.push(...rows);

            if (!rows.length || (Number.isFinite(total) && collectedRows.length >= total)) {
                break;
            }

            page += 1;
        }

        return collectedRows;
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

            // If this tab matches the selected status, activate it
            if (t.dataset.status === status) {
                t.classList.add('active');
            }
        });

        // Reload Grid
        this.loadProducts();
    },

    applyProductSearch: function () {
        const input = document.getElementById('productSearchInput');
        this.productSearchQuery = String(input?.value || '').trim();
        this.loadProducts();
    },

    clearProductSearch: function () {
        this.productSearchQuery = '';
        const input = document.getElementById('productSearchInput');
        if (input) {
            input.value = '';
        }
        this.loadProducts();
    },

    setProductDeliveryFilter: function (value = 'all') {
        const normalizedValue = String(value || '').trim().toLowerCase();
        this.currentProductDeliveryFilter = ['all', 'key', 'api'].includes(normalizedValue)
            ? normalizedValue
            : 'all';
        this.loadProducts();
    },

    renderPagination: function (elementId, currentPage, total, pageSize, loadFuncStr) {
        const container = document.getElementById(elementId);
        if (!container) return;
        const totalPages = Math.ceil(total / pageSize) || 1;

        container.innerHTML = `
            <div class="pagination-shell">
                <div class="pagination-control">
                    <button class="pagination-btn pagination-btn--step" data-shop-action="pagination-go" data-pagination-target="${loadFuncStr}" data-pagination-page="${currentPage - 1}" ${currentPage <= 1 ? 'disabled' : ''}>
                        −
                    </button>
                    
                    <input type="number" class="pagination-input" 
                        value="${currentPage}" min="1" max="${totalPages}" data-shop-change="pagination-go" data-pagination-target="${loadFuncStr}" data-pagination-max="${totalPages}">
                    
                    <button class="pagination-btn pagination-btn--step" data-shop-action="pagination-go" data-pagination-target="${loadFuncStr}" data-pagination-page="${currentPage + 1}" ${currentPage >= totalPages ? 'disabled' : ''}>
                        +
                    </button>
                </div>
                <div class="pagination-total pagination-total--compact">共 ${totalPages} 页 / ${total} 条</div>
            </div>
        `;
    },

    invokePaginationTarget: function (targetName, pageValue) {
        const handler = this[targetName];
        if (typeof handler !== 'function') {
            console.warn(`[ShopAdmin] Unknown pagination target: ${targetName}`);
            return;
        }

        const page = Number.parseInt(pageValue, 10);

        if (!Number.isFinite(page) || page < 1) {
            return;
        }

        handler.call(this, page);
    },

    hideProductModal: function () {
        const modal = document.getElementById('productModal');
        if (modal) {
            modal.classList.remove('active');
        }
    },

    bindOverlayDismiss: function (overlayOrId, onDismiss) {
        const overlay = typeof overlayOrId === 'string'
            ? document.getElementById(overlayOrId)
            : overlayOrId;
        if (!(overlay instanceof HTMLElement) || overlay.dataset.overlayDismissBound === '1') {
            return overlay instanceof HTMLElement ? overlay : null;
        }

        overlay.dataset.overlayDismissBound = '1';
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) {
                onDismiss?.();
            }
        });
        return overlay;
    },

    bindProductModalOverlayDismiss: function () {
        this.bindOverlayDismiss('productModal', () => {
            this.hideProductModal();
        });
    },

    bindStaticOverlayDismisses: function () {
        this.bindProductModalOverlayDismiss();
        this.bindOverlayDismiss('releaseReserveModal', () => {
            this.closeReleaseModal();
        });
        this.bindOverlayDismiss('importInventoryModal', () => {
            this.closeImportModal();
        });
    },

    isManagedShopSelect: function (element) {
        return element instanceof HTMLSelectElement
            && element.dataset.shopCustomSelect === 'true';
    },

    getManagedShopSelects: function (root = document) {
        if (!(root instanceof Element) && root !== document) {
            return [];
        }
        return Array.from(root.querySelectorAll('select[data-shop-custom-select="true"]'));
    },

    closeShopCustomSelects: function (exceptSelectId = '') {
        document.querySelectorAll('.shop-custom-select.is-open').forEach((wrapper) => {
            if (exceptSelectId && wrapper.dataset.selectId === exceptSelectId) {
                return;
            }
            wrapper.classList.remove('is-open');
            const trigger = wrapper.querySelector('.shop-custom-select__trigger');
            if (trigger instanceof HTMLElement) {
                trigger.setAttribute('aria-expanded', 'false');
            }
        });
    },

    scheduleShopCustomSelectSync: function (select) {
        if (!this.isManagedShopSelect(select)) {
            return;
        }

        if (select.__shopCustomSyncFrame) {
            window.cancelAnimationFrame(select.__shopCustomSyncFrame);
        }

        select.__shopCustomSyncFrame = window.requestAnimationFrame(() => {
            select.__shopCustomSyncFrame = 0;
            this.syncShopCustomSelect(select);
        });
    },

    observeShopCustomSelect: function (select) {
        if (!this.isManagedShopSelect(select) || select.__shopCustomObserver) {
            return;
        }

        const observer = new MutationObserver(() => {
            this.scheduleShopCustomSelectSync(select);
        });

        observer.observe(select, {
            attributes: true,
            attributeFilter: ['disabled'],
            childList: true,
            subtree: true
        });

        select.__shopCustomObserver = observer;
    },

    ensureShopCustomSelectBridge: function () {
        if (this.shopCustomSelectBridgeReady) {
            return;
        }
        this.shopCustomSelectBridgeReady = true;

        const selectProto = window.HTMLSelectElement?.prototype;
        if (!selectProto) {
            return;
        }

        const patchProperty = (propertyName) => {
            const descriptor = Object.getOwnPropertyDescriptor(selectProto, propertyName);
            if (!descriptor?.configurable || typeof descriptor.set !== 'function' || typeof descriptor.get !== 'function') {
                return;
            }

            const markerKey = `__shopCustomSelectPatched_${propertyName}`;
            if (selectProto[markerKey]) {
                return;
            }

            Object.defineProperty(selectProto, propertyName, {
                configurable: true,
                enumerable: descriptor.enumerable,
                get: function getShopSelectProperty() {
                    return descriptor.get.call(this);
                },
                set: function setShopSelectProperty(nextValue) {
                    descriptor.set.call(this, nextValue);
                    if (window.ShopAdmin?.isManagedShopSelect?.(this)) {
                        window.ShopAdmin.scheduleShopCustomSelectSync(this);
                    }
                }
            });

            selectProto[markerKey] = true;
        };

        patchProperty('value');
        patchProperty('selectedIndex');
    },

    createShopCustomSelectWrapper: function (select) {
        if (!this.isManagedShopSelect(select)) {
            return null;
        }

        let wrapper = select.nextElementSibling;
        if (!(wrapper instanceof HTMLElement) || !wrapper.classList.contains('shop-custom-select')) {
            wrapper = document.createElement('div');
            const classNames = ['shop-custom-select'];
            select.classList.forEach((className) => {
                classNames.push(className);
            });
            wrapper.className = classNames.join(' ');
            wrapper.dataset.selectId = select.id || '';
            wrapper.innerHTML = `
                <button type="button" class="shop-custom-select__trigger" aria-haspopup="listbox" aria-expanded="false">
                    <span class="shop-custom-select__label"></span>
                    <i class="fas fa-chevron-down shop-custom-select__icon" aria-hidden="true"></i>
                </button>
                <div class="shop-custom-select__menu" role="listbox"></div>
            `;
            select.insertAdjacentElement('afterend', wrapper);

            wrapper.addEventListener('click', (event) => {
                const target = event.target instanceof Element ? event.target : null;
                if (!target) {
                    return;
                }

                const option = target.closest('[data-shop-custom-select-option]');
                if (option instanceof HTMLElement) {
                    event.preventDefault();
                    const optionValue = option.dataset.value ?? '';
                    if (select.disabled || option.getAttribute('aria-disabled') === 'true') {
                        return;
                    }
                    select.value = optionValue;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    this.syncShopCustomSelect(select);
                    this.closeShopCustomSelects();
                    return;
                }

                const trigger = target.closest('.shop-custom-select__trigger');
                if (!(trigger instanceof HTMLElement) || select.disabled) {
                    return;
                }

                event.preventDefault();
                const shouldOpen = !wrapper.classList.contains('is-open');
                this.closeShopCustomSelects(shouldOpen ? (select.id || '') : '');
                wrapper.classList.toggle('is-open', shouldOpen);
                trigger.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
            });

            wrapper.addEventListener('keydown', (event) => {
                if (select.disabled) {
                    return;
                }

                if (event.key === 'Escape') {
                    wrapper.classList.remove('is-open');
                    const trigger = wrapper.querySelector('.shop-custom-select__trigger');
                    trigger?.setAttribute('aria-expanded', 'false');
                    trigger?.focus();
                    return;
                }

                if ((event.key === 'Enter' || event.key === ' ') && event.target instanceof HTMLElement && event.target.classList.contains('shop-custom-select__trigger')) {
                    event.preventDefault();
                    event.target.click();
                }
            });
        }

        select.classList.add('shop-native-select--hidden');
        select.setAttribute('tabindex', '-1');
        this.observeShopCustomSelect(select);
        return wrapper;
    },

    syncShopCustomSelect: function (selectOrId) {
        const select = typeof selectOrId === 'string'
            ? document.getElementById(selectOrId)
            : selectOrId;
        if (!this.isManagedShopSelect(select)) {
            return;
        }

        const wrapper = this.createShopCustomSelectWrapper(select);
        if (!(wrapper instanceof HTMLElement)) {
            return;
        }

        const trigger = wrapper.querySelector('.shop-custom-select__trigger');
        const label = wrapper.querySelector('.shop-custom-select__label');
        const menu = wrapper.querySelector('.shop-custom-select__menu');
        if (!(trigger instanceof HTMLElement) || !(label instanceof HTMLElement) || !(menu instanceof HTMLElement)) {
            return;
        }

        const options = Array.from(select.options || []);
        const selectedOption = options.find((option) => option.selected) || options[select.selectedIndex] || options[0] || null;
        label.textContent = selectedOption?.textContent?.trim() || '请选择';
        wrapper.classList.toggle('is-disabled', !!select.disabled);
        trigger.disabled = !!select.disabled;
        trigger.setAttribute('aria-expanded', wrapper.classList.contains('is-open') ? 'true' : 'false');
        menu.setAttribute('aria-label', select.getAttribute('aria-label') || label.textContent || '下拉菜单');

        menu.innerHTML = options
            .filter((option) => !option.hidden)
            .map((option) => {
                const optionValue = String(option.value ?? '');
                const selected = optionValue === String(select.value ?? '');
                const disabled = option.disabled;
                return `
                    <button
                        type="button"
                        class="shop-custom-select__option${selected ? ' is-selected' : ''}"
                        role="option"
                        aria-selected="${selected ? 'true' : 'false'}"
                        aria-disabled="${disabled ? 'true' : 'false'}"
                        data-shop-custom-select-option="true"
                        data-value="${this.escapeForAttr(optionValue)}"
                    >
                        <span class="shop-custom-select__option-copy">${this.escapeHtml(option.textContent?.trim() || '')}</span>
                        ${selected ? '<i class="fas fa-check shop-custom-select__option-check" aria-hidden="true"></i>' : ''}
                    </button>
                `;
            }).join('');
    },

    enhanceShopCustomSelects: function (root = document) {
        this.ensureShopCustomSelectBridge();
        this.getManagedShopSelects(root).forEach((select) => {
            this.syncShopCustomSelect(select);
        });
    },

    normalizeShopTabName: function (tabName) {
        const normalized = String(tabName || '').trim().toLowerCase();
        return this.SHOP_TAB_IDS.includes(normalized) ? normalized : 'products';
    },

    getShopTabLoadState: function (tabName) {
        return this.shopTabLoadState[this.normalizeShopTabName(tabName)] || 'idle';
    },

    isShopModuleVisible: function () {
        return document.getElementById('module-shop')?.classList.contains('active') === true;
    },

    clearShopTabPrefetch: function () {
        if (!this.shopTabPrefetchHandle) {
            return;
        }

        if (this.shopTabPrefetchMode === 'idle' && typeof window.cancelIdleCallback === 'function') {
            window.cancelIdleCallback(this.shopTabPrefetchHandle);
        } else {
            window.clearTimeout(this.shopTabPrefetchHandle);
        }

        this.shopTabPrefetchHandle = 0;
        this.shopTabPrefetchMode = '';
    },

    invalidateShopTabCache: function (tabNames = this.SHOP_TAB_IDS) {
        const queue = Array.isArray(tabNames) ? tabNames : [tabNames];
        queue.forEach((tabName) => {
            const normalizedTab = this.normalizeShopTabName(tabName);
            this.shopTabLoadGeneration[normalizedTab] = Number(this.shopTabLoadGeneration[normalizedTab] || 0) + 1;
            this.shopTabLoadState[normalizedTab] = 'idle';
            delete this.shopTabLoadPromiseMap[normalizedTab];
        });
        this.clearShopTabPrefetch();
    },

    getShopTabPrefetchQueue: function (activeTab = this.currentTab) {
        const normalizedActiveTab = this.normalizeShopTabName(activeTab);
        return this.SHOP_TAB_IDS.filter((tabName) => {
            if (tabName === normalizedActiveTab) {
                return false;
            }

            const state = this.getShopTabLoadState(tabName);
            return state !== 'loaded' && state !== 'loading';
        });
    },

    runShopTabLoader: function (tabName, loader) {
        const normalizedTab = this.normalizeShopTabName(tabName);
        const existingPromise = this.shopTabLoadPromiseMap[normalizedTab];
        if (existingPromise) {
            return existingPromise;
        }

        const generation = Number(this.shopTabLoadGeneration[normalizedTab] || 0);
        this.shopTabLoadState[normalizedTab] = 'loading';

        const loadPromise = Promise.resolve()
            .then(() => loader())
            .then((result) => {
                if (Number(this.shopTabLoadGeneration[normalizedTab] || 0) === generation) {
                    this.shopTabLoadState[normalizedTab] = 'loaded';
                }
                return result;
            })
            .catch((error) => {
                if (Number(this.shopTabLoadGeneration[normalizedTab] || 0) === generation) {
                    this.shopTabLoadState[normalizedTab] = 'error';
                }
                throw error;
            })
            .finally(() => {
                if (this.shopTabLoadPromiseMap[normalizedTab] === loadPromise) {
                    delete this.shopTabLoadPromiseMap[normalizedTab];
                }
            });

        this.shopTabLoadPromiseMap[normalizedTab] = loadPromise;
        return loadPromise;
    },

    ensureShopTabReady: function (tabName, options = {}) {
        const normalizedTab = this.normalizeShopTabName(tabName);
        const force = options.force === true;

        if (force) {
            this.invalidateShopTabCache(normalizedTab);
        } else {
            if (this.getShopTabLoadState(normalizedTab) === 'loaded') {
                return Promise.resolve();
            }

            const existingPromise = this.shopTabLoadPromiseMap[normalizedTab];
            if (existingPromise) {
                return existingPromise;
            }
        }

        switch (normalizedTab) {
            case 'products':
                return this.runShopTabLoader(normalizedTab, () => Promise.all([
                    this.renderProductCategoryFilters(),
                    this.loadProducts()
                ]));
            case 'import':
                return this.runShopTabLoader(normalizedTab, () => this.initImportView());
            case 'inventory':
                return this.runShopTabLoader(normalizedTab, () => this.initInventoryBrowser());
            case 'orders':
                return this.runShopTabLoader(normalizedTab, () => this.searchOrders(this.ordersPage || 1));
            case 'fulfillment':
                return this.runShopTabLoader(normalizedTab, () => this.loadDeliveryTasks(this.deliveryTaskPage || 1));
            default:
                return Promise.resolve();
        }
    },

    scheduleShopTabPrefetch: function (activeTab = this.currentTab) {
        const queue = this.getShopTabPrefetchQueue(activeTab);
        this.clearShopTabPrefetch();

        if (!this.isShopModuleVisible() || queue.length === 0) {
            return;
        }

        const generation = ++this.shopTabPrefetchGeneration;
        const activeModuleTab = this.normalizeShopTabName(activeTab);
        const runPrefetch = async () => {
            this.shopTabPrefetchHandle = 0;
            this.shopTabPrefetchMode = '';

            for (const tabName of queue) {
                if (
                    generation !== this.shopTabPrefetchGeneration
                    || !this.isShopModuleVisible()
                    || this.normalizeShopTabName(this.currentTab) !== activeModuleTab
                ) {
                    return;
                }

                try {
                    await this.ensureShopTabReady(tabName, { background: true });
                } catch (error) {
                    console.warn(`[ShopAdmin] Failed to prefetch ${tabName} tab:`, error);
                }
            }
        };

        if (typeof window.requestIdleCallback === 'function') {
            this.shopTabPrefetchMode = 'idle';
            this.shopTabPrefetchHandle = window.requestIdleCallback(() => {
                void runPrefetch();
            }, { timeout: 1200 });
            return;
        }

        this.shopTabPrefetchMode = 'timeout';
        this.shopTabPrefetchHandle = window.setTimeout(() => {
            void runPrefetch();
        }, 240);
    },

    bindShopContextListeners: function () {
        if (this.shopContextListenersBound) {
            return;
        }

        this.shopContextListenersBound = true;
        window.addEventListener('admin-site-changed', () => {
            this.handleSiteChange();
        });
    },

    handleSiteChange: function () {
        const requestId = ++this.shopSiteChangeRequestId;
        this.invalidateShopTabCache();
        if (!this.isShopModuleVisible()) {
            return;
        }

        Promise.resolve().then(() => {
            if (requestId !== this.shopSiteChangeRequestId) {
                return;
            }

            return this.ensureShopTabReady(this.currentTab, { force: true });
        }).then(() => {
            if (requestId !== this.shopSiteChangeRequestId) {
                return;
            }

            this.scheduleShopTabPrefetch(this.currentTab);
        }).catch((error) => {
            console.error('[ShopAdmin] Failed to reload current tab after site change:', error);
        });
    },

    closeDynamicModal: function (modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) return;

        modal.classList.remove('is-visible');
        window.setTimeout(() => {
            modal.remove();
        }, 280);
    },

    updateLegacyImportLineCount: function () {
        const textarea = document.getElementById('importContentInput');
        const counter = document.getElementById('importLineCount');
        if (!textarea || !counter) {
            return;
        }

        const lineCount = textarea.value.trim() ? textarea.value.trim().split('\n').length : 0;
        counter.textContent = `(${lineCount}行)`;
    },

    productGridCache: new Map(),
    categoryFetchPromise: null,
    productCategoryDropdownPromise: null,
    activeProductEditRequestId: '',

    updateImportViewLineCount: function () {
        const textarea = document.getElementById('importViewContentInput');
        const counter = document.getElementById('importViewLineCount');
        if (!textarea || !counter) {
            return;
        }

        const lineCount = textarea.value.trim() ? textarea.value.trim().split('\n').length : 0;
        counter.textContent = `(${lineCount}个)`;
    },

    toggleMobileImportView: function (view) {
        const layout = document.querySelector('.import-layout');
        const sidebarBtn = document.getElementById('mobileImportSidebarBtn');
        const mainBtn = document.getElementById('mobileImportMainBtn');

        if (!layout || !sidebarBtn || !mainBtn) {
            return;
        }

        if (view === 'sidebar') {
            layout.classList.remove('show-main');
            layout.classList.add('show-sidebar');
            sidebarBtn.classList.add('active');
            mainBtn.classList.remove('active');
        } else {
            layout.classList.remove('show-sidebar');
            layout.classList.add('show-main');
            mainBtn.classList.add('active');
            sidebarBtn.classList.remove('active');
        }
    },

    bindDelegatedHandlers: function () {
        if (this.delegatedHandlersBound) {
            return;
        }
        this.delegatedHandlersBound = true;

        document.addEventListener('click', (event) => {
            const target = event.target instanceof Element ? event.target : event.target?.parentElement;
            if (!target) {
                return;
            }

            const actionEl = target.closest('[data-shop-action]');
            if (!actionEl) {
                return;
            }

            switch (actionEl.dataset.shopAction) {
                case 'import-toggle-mobile-view':
                    this.toggleMobileImportView(actionEl.dataset.importMobileView);
                    break;
                case 'import-create-category':
                    this.showCreateCategoryDialog();
                    break;
                case 'import-category-rename':
                    this.renameCategoryFromMenu();
                    break;
                case 'import-category-color':
                    this.setCategoryColor(actionEl.dataset.categoryColor);
                    break;
                case 'import-category-delete':
                    this.deleteCategoryFromMenu();
                    break;
                case 'pagination-go':
                    this.invokePaginationTarget(actionEl.dataset.paginationTarget, actionEl.dataset.paginationPage);
                    break;
                case 'shop-switch-tab':
                    this.switchTab(actionEl.dataset.shopTab);
                    break;
                case 'product-open-create-modal':
                    this.openProductModal();
                    break;
                case 'product-filter-category':
                    this.filterCategory(actionEl.dataset.category, actionEl);
                    break;
                case 'product-filter-status':
                    this.filterStatus(actionEl.dataset.status, actionEl);
                    break;
                case 'product-apply-search':
                    this.applyProductSearch();
                    break;
                case 'product-clear-search':
                    this.clearProductSearch();
                    break;
                case 'product-toggle-selection-mode':
                    this.toggleProductSelectionMode();
                    break;
                case 'product-toggle-batch-menu':
                    this.toggleProductBatchMenu();
                    break;
                case 'product-select-all':
                    this.selectAllProducts();
                    break;
                case 'product-batch-delete':
                    this.batchDeleteProducts();
                    break;
                case 'product-export-selected':
                    this.exportProducts(true);
                    break;
                case 'product-edit':
                    this.editProduct(actionEl.dataset.productId);
                    break;
                case 'product-toggle-status':
                    this.toggleStatus(actionEl.dataset.productId, actionEl.dataset.newStatus === 'true');
                    break;
                case 'product-delete':
                    this.deleteProduct(actionEl.dataset.productId, actionEl.dataset.productName || '');
                    break;
                case 'inventory-toggle-selection-mode':
                    this.toggleSelectionMode();
                    break;
                case 'inventory-toggle-batch-menu':
                    this.toggleBatchMenu();
                    break;
                case 'inventory-select-all-rows':
                    this.selectAllRows();
                    break;
                case 'inventory-batch-delete':
                    this.batchDelete();
                    break;
                case 'inventory-export-selected':
                    this.exportInventory(true);
                    break;
                case 'inventory-export-all':
                    this.exportInventory();
                    break;
                case 'inventory-open-release-modal':
                    this.openReleaseModal();
                    break;
                case 'inventory-toggle-category-menu':
                    document.getElementById('custom-inv-menu')?.classList.toggle('show');
                    break;
                case 'inventory-select-category':
                    this.selectInvCategory(
                        actionEl.dataset.category,
                        actionEl.dataset.categoryLabel,
                        actionEl
                    );
                    break;
                case 'inventory-import-submit':
                    this.importInventory(actionEl);
                    break;
                case 'inventory-import-from-view':
                    this.doImportFromView();
                    break;
                case 'inventory-release-modal-close':
                    this.closeReleaseModal();
                    break;
                case 'inventory-release-modal-submit':
                    this.releaseReserve();
                    break;
                case 'inventory-close-import-modal':
                    this.closeImportModal?.();
                    break;
                case 'inventory-do-import':
                    this.doImport?.();
                    break;
                case 'inventory-toggle-selection-cell':
                    this.toggleSelectionClick(actionEl);
                    break;
                case 'inventory-copy-content':
                    this.copyContent(actionEl, event);
                    break;
                case 'inventory-show-detail':
                    this.showInventoryDetail(actionEl.dataset.inventoryId);
                    break;
                case 'inventory-open-fault-modal':
                    this.openFaultModal(actionEl.dataset.inventoryId);
                    break;
                case 'inventory-delete-item':
                    this.deleteInventoryItem(actionEl.dataset.inventoryId);
                    break;
                case 'inventory-freeze-item':
                    this.freezeInventoryItem(actionEl.dataset.inventoryId, actionEl.dataset.freeze === 'true');
                    break;
                case 'inventory-release-item':
                    this.releaseOne(actionEl.dataset.inventoryId);
                    break;
                case 'inventory-detail-close':
                    this.closeDynamicModal(actionEl.dataset.modalId);
                    break;
                case 'inventory-detail-copy-main':
                case 'inventory-detail-copy-entry':
                    navigator.clipboard.writeText(actionEl.dataset.content || '').then(() => {
                        if (actionEl.dataset.shopAction === 'inventory-detail-copy-main') {
                            const originalHtml = actionEl.innerHTML;
                            actionEl.innerHTML = '<i class="fas fa-check"></i> 已复制';
                            setTimeout(() => {
                                actionEl.innerHTML = originalHtml;
                            }, 1000);
                        } else {
                            actionEl.classList.add('shop-inventory-detail-entry--copied');
                            setTimeout(() => {
                                actionEl.classList.remove('shop-inventory-detail-entry--copied');
                            }, 1000);
                        }
                    }).catch((error) => {
                        console.error('Copy failed:', error);
                        alert('复制失败');
                    });
                    break;
                case 'inventory-detail-copy-list':
                    this.copyListContent(actionEl);
                    break;
                case 'inventory-detail-export-list':
                    this.exportListContent(actionEl, actionEl.dataset.filename);
                    break;
                case 'fault-modal-close':
                    this.closeDynamicModal(actionEl.dataset.modalId || 'markFaultModal');
                    break;
                case 'fault-modal-submit':
                    this.submitFault(actionEl.dataset.inventoryId);
                    break;
                case 'product-close-modal':
                    this.hideProductModal();
                    break;
                case 'product-toggle-category-dropdown':
                    this.toggleCategoryDropdown();
                    break;
                case 'product-upload-icon':
                    document.getElementById('iconUploadFile')?.click();
                    break;
                case 'product-add-tiered-pricing':
                    this.addTieredPricingRow();
                    break;
                case 'product-remove-tiered-pricing-row':
                    actionEl.closest('.tiered-pricing-row')?.remove();
                    break;
                case 'product-toggle-delivery-type-dropdown':
                    this.toggleDeliveryTypeDropdown();
                    break;
                case 'product-select-delivery-type':
                    this.selectDeliveryType(actionEl.dataset.deliveryType, actionEl.dataset.deliveryLabel);
                    break;
                case 'product-select-category':
                    this.selectCategory(actionEl.dataset.categoryName, actionEl.dataset.categoryColor);
                    break;
                case 'product-show-add-category-input':
                    this.showAddCategoryInput();
                    break;
                case 'product-cancel-add-category':
                    this.cancelAddCategory();
                    break;
                case 'product-save-new-category':
                    this.saveNewCategory();
                    break;
                case 'order-show-content':
                    this.showOrderContent(actionEl.dataset.orderId, actionEl.dataset.itemsData);
                    break;
                case 'order-close-content':
                    this.currentOrderDetailId = '';
                    this.closeDynamicModal(actionEl.dataset.modalId || 'orderContentModal');
                    break;
                case 'order-refresh-detail':
                    this.showOrderContent(actionEl.dataset.orderId, actionEl.dataset.itemsData);
                    break;
                case 'order-copy-all-content':
                    navigator.clipboard.writeText(actionEl.dataset.content || '').then(() => {
                        const originalHtml = actionEl.innerHTML;
                        actionEl.innerHTML = '<i class="fas fa-check"></i> 已复制';
                        setTimeout(() => {
                            actionEl.innerHTML = originalHtml;
                        }, 1600);
                    }).catch(() => {
                        alert('复制失败，请手动复制');
                    });
                    break;
                case 'order-actions-stop':
                    break;
                case 'order-refund':
                    this.refundOrder(actionEl.dataset.orderId);
                    break;
                case 'refund-close-modal':
                    this.closeDynamicModal(actionEl.dataset.modalId || 'refundModal');
                    break;
                case 'refund-submit':
                    this.submitRefund(actionEl.dataset.orderId, actionEl);
                    break;
                case 'order-user-flow-focus':
                    this.applyOrderUserFlowFocus(
                        actionEl.dataset.orderIssueKind,
                        actionEl.dataset.orderIssueValue
                    );
                    break;
                case 'order-user-flow-open-destination':
                    this.openOrderUserFlowDestination(
                        actionEl.dataset.analyticsDestination,
                        actionEl.dataset.orderIssueKind,
                        actionEl.dataset.orderIssueValue
                    );
                    break;
                case 'orders-search':
                    this.clearOrderSearchContext({ preserveFilters: true });
                    this.searchOrders(1);
                    break;
                case 'orders-export':
                    this.exportOrders();
                    break;
                case 'delivery-copy-restore-link':
                    this.copyDeliveryRestoreLink();
                    break;
                case 'delivery-clear-all-filter-breadcrumbs':
                    this.clearAllDeliveryFilterBreadcrumbs();
                    break;
                case 'delivery-apply-task-query':
                    this.applyDeliveryTaskQuery();
                    break;
                case 'delivery-reload-tasks': {
                    const pageMode = actionEl.dataset.deliveryPageMode || 'first';
                    const page = pageMode === 'current' ? (this.deliveryTaskPage || 1) : 1;
                    this.loadDeliveryTasks(page);
                    break;
                }
                case 'delivery-save-strategy':
                    this.saveDeliveryStrategy();
                    break;
                case 'delivery-task-action':
                    this.performDeliveryTaskAction(
                        actionEl.dataset.deliveryTaskId,
                        actionEl.dataset.deliveryTaskCommand
                    );
                    break;
                case 'delivery-jump-audit':
                    this.jumpToDeliveryConflictAuditForTask(
                        actionEl.dataset.deliveryTaskId,
                        actionEl.dataset.deliveryOrderId
                    );
                    break;
                case 'delivery-conflict-audit-select':
                    this.toggleDeliveryConflictAuditSelection(
                        actionEl.dataset.deliveryAuditId,
                        actionEl.dataset.deliveryAuditCreatedAt,
                        actionEl.dataset.deliveryTaskId,
                        actionEl.dataset.deliveryOrderId,
                        actionEl.dataset.deliveryTargetKey,
                        actionEl.dataset.deliveryChannelKey,
                        actionEl.dataset.deliveryReasonKey,
                        actionEl.dataset.deliveryScope
                    );
                    break;
                case 'delivery-conflict-audit-reason-quick-filter':
                    this.applyDeliveryConflictAuditReasonQuickFilter(actionEl.dataset.deliveryReasonKey);
                    break;
                case 'delivery-conflict-audit-target-quick-filter':
                    this.applyDeliveryConflictAuditTargetQuickFilter(actionEl.dataset.deliveryTargetKey);
                    break;
                case 'delivery-conflict-audit-channel-quick-filter':
                    this.applyDeliveryConflictAuditChannelQuickFilter(actionEl.dataset.deliveryChannelKey);
                    break;
                case 'delivery-toggle-conflict-dead-letter-focus':
                    this.toggleDeliveryConflictDeadLetterFocus();
                    break;
                case 'delivery-hotspot-filter':
                    this.applyDeliveryHotspotFilter(
                        actionEl.dataset.deliveryHotspotType,
                        actionEl.dataset.deliveryHotspotKey
                    );
                    break;
                case 'delivery-hotspot-metric-drilldown':
                    this.applyDeliveryHotspotMetricDrilldown(
                        actionEl.dataset.deliveryHotspotType,
                        actionEl.dataset.deliveryHotspotKey,
                        actionEl.dataset.deliveryHotspotMetric
                    );
                    break;
                case 'delivery-hotspot-reason-drilldown':
                    this.applyDeliveryHotspotReasonDrilldown(
                        actionEl.dataset.deliveryHotspotType,
                        actionEl.dataset.deliveryHotspotKey,
                        actionEl.dataset.deliveryReasonKey
                    );
                    break;
                case 'delivery-conflict-bucket-toggle':
                    this.toggleDeliveryConflictBucketFilter(
                        actionEl.dataset.deliveryBucketStart,
                        actionEl.dataset.deliveryBucketEnd,
                        actionEl.dataset.deliveryBucketLabel
                    );
                    break;
                case 'delivery-conflict-bucket-dead-letter-focus':
                    this.toggleDeliveryConflictDeadLetterBucketFocus(
                        actionEl.dataset.deliveryBucketStart,
                        actionEl.dataset.deliveryBucketEnd,
                        actionEl.dataset.deliveryBucketLabel
                    );
                    break;
                case 'delivery-clear-task-query':
                    this.clearDeliveryTaskQuery();
                    break;
                case 'delivery-clear-conflict-bucket':
                    this.clearDeliveryConflictBucketFilter();
                    break;
                case 'delivery-clear-conflict-audit-selection':
                    this.clearDeliveryConflictAuditSelection();
                    break;
                case 'delivery-clear-conflict-dead-letter-focus':
                    this.clearDeliveryConflictDeadLetterFocus();
                    break;
                case 'delivery-clear-task-status-filter':
                    this.clearDeliveryTaskStatusFilter();
                    break;
                case 'delivery-issue-summary-focus':
                    this.applyDeliveryIssueSummaryFocus(
                        actionEl.dataset.deliveryIssueFocusKind,
                        actionEl.dataset.deliveryIssueFocusValue
                    );
                    break;
                case 'delivery-priority-action':
                    this.applyDeliveryPriorityAction(actionEl.dataset.deliveryPriorityKey);
                    break;
                case 'delivery-clear-dead-letter-reason-filter':
                    this.clearDeliveryDeadLetterReasonFilter();
                    break;
                case 'delivery-clear-lock-state-filter':
                    this.clearDeliveryLockStateFilter();
                    break;
                case 'delivery-clear-conflict-audit-reason-filter':
                    this.clearDeliveryConflictAuditReasonFilter();
                    break;
                case 'delivery-clear-conflict-audit-target-filter':
                    this.clearDeliveryConflictAuditTargetFilter();
                    break;
                case 'delivery-clear-conflict-audit-channel-filter':
                    this.clearDeliveryConflictAuditChannelFilter();
                    break;
                case 'delivery-apply-conflict-audit-filters':
                    this.applyDeliveryConflictAuditFilters();
                    break;
                case 'delivery-clear-conflict-audit-filters':
                    this.clearDeliveryConflictAuditFilters();
                    break;
            default:
                break;
            }
        }, true);

        document.addEventListener('change', (event) => {
            const target = event.target instanceof Element ? event.target : event.target?.parentElement;
            if (!target) {
                return;
            }

            const actionEl = target.closest('[data-shop-change]');
            if (!actionEl) {
                return;
            }

            switch (actionEl.dataset.shopChange) {
                case 'pagination-go': {
                    const max = Math.max(1, Number.parseInt(actionEl.dataset.paginationMax || '1', 10) || 1);
                    let nextPage = Number.parseInt(actionEl.value || '1', 10) || 1;
                    if (nextPage < 1) nextPage = 1;
                    if (nextPage > max) nextPage = max;
                    actionEl.value = String(nextPage);
                    this.invokePaginationTarget(actionEl.dataset.paginationTarget, nextPage);
                    break;
                }
                case 'inventory-toggle-select-all':
                    this.toggleSelectAll(actionEl);
                    break;
                case 'inventory-selection-count':
                    this.updateSelectionCount();
                    break;
                case 'delivery-task-status-filter':
                    this.setDeliveryTaskStatusFilter(actionEl.value);
                    break;
                case 'delivery-analytics-window':
                    this.setDeliveryAnalyticsWindow(actionEl.value);
                    break;
                case 'delivery-dead-letter-reason':
                    this.setDeliveryDeadLetterReasonFilter(actionEl.value);
                    break;
                case 'delivery-lock-state':
                    this.setDeliveryLockStateFilter(actionEl.value);
                    break;
                case 'delivery-conflict-audit-reason':
                    this.applyDeliveryConflictAuditFilters();
                    break;
                case 'product-delivery-filter':
                    this.setProductDeliveryFilter(actionEl.value);
                    break;
                case 'orders-filter-refund':
                    this.orderRefundStatusFilter = this.normalizeOrderRefundStatusFilter(actionEl.value);
                    this.syncOrderFilterControls();
                    this.searchOrders(1);
                    break;
                case 'orders-filter-delivery':
                    this.orderDeliveryStatusFilter = this.normalizeOrderDeliveryStatusFilter(actionEl.value);
                    this.syncOrderFilterControls();
                    this.searchOrders(1);
                    break;
                case 'product-handle-icon-upload':
                    this.handleIconUpload(actionEl);
                    break;
                case 'product-toggle-purchase-notes':
                    this.togglePurchaseNotes(actionEl.checked);
                    break;
                case 'product-toggle-usage-instructions':
                    this.toggleUsageInstructions(actionEl.checked);
                    break;
                case 'product-selection-count':
                    this.updateProductSelectionCount();
                    break;
            default:
                break;
            }
        });

        document.addEventListener('input', (event) => {
            const target = event.target instanceof Element ? event.target : event.target?.parentElement;
            if (!target) {
                return;
            }

            const actionEl = target.closest('[data-shop-input]');
            if (!actionEl) {
                return;
            }

            switch (actionEl.dataset.shopInput) {
                case 'product-update-preview':
                    this.updatePreview();
                    break;
                case 'inventory-import-line-count':
                    this.updateLegacyImportLineCount();
                    break;
                case 'import-view-line-count':
                    this.updateImportViewLineCount();
                    break;
            default:
                break;
            }
        });

        document.addEventListener('keydown', (event) => {
            const target = event.target instanceof Element ? event.target : event.target?.parentElement;
            if (!target) {
                return;
            }

            const actionEl = target.closest('[data-shop-keydown]');
            if (!actionEl) {
                return;
            }

            switch (actionEl.dataset.shopKeydown) {
                case 'inventory-search-enter':
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        this.loadInventoryList();
                    }
                    break;
                case 'orders-search-enter':
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        this.clearOrderSearchContext({ preserveFilters: true });
                        this.searchOrders(1);
                    }
                    break;
                case 'product-search-enter':
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        this.applyProductSearch();
                    }
                    break;
                case 'delivery-task-query-enter':
                    this.handleDeliveryTaskQueryKeydown(event);
                    break;
                case 'delivery-conflict-audit-filter-enter':
                    this.handleDeliveryConflictAuditFilterKeydown(event);
                    break;
                case 'product-save-new-category':
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        this.saveNewCategory();
                    }
                    break;
                default:
                    break;
            }
        }, true);

        document.addEventListener('submit', (event) => {
            const form = event.target instanceof HTMLFormElement ? event.target : null;
            if (!form) return;

            if (form.id === 'productModalForm') {
                event.preventDefault();
                this.saveProduct();
            }
        });

        document.addEventListener('click', (event) => {
            const overlay = event.target instanceof HTMLElement && event.target.matches('[data-shop-overlay-close]');
            if (!overlay || event.target !== overlay) return;

            if (overlay.dataset.shopOverlayClose === 'product-modal') {
                this.hideProductModal();
            } else if (overlay.dataset.shopOverlayClose === 'dynamic-modal') {
                this.closeDynamicModal(overlay.dataset.modalId);
            }
        });

        document.addEventListener('error', (event) => {
            const image = event.target instanceof HTMLImageElement ? event.target : null;
            const fallbackSrc = image?.dataset.fallbackSrc;
            if (!image || !fallbackSrc || image.src === fallbackSrc) {
                return;
            }

            image.src = fallbackSrc;
        }, true);
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
            const currentCategory = this.currentCategory || 'all';
            const allBtn = document.createElement('button');
            allBtn.className = `filter-tab${currentCategory === 'all' ? ' active' : ''}`;
            allBtn.textContent = '全部';
            allBtn.dataset.shopAction = 'product-filter-category';
            allBtn.dataset.category = 'all';
            container.appendChild(allBtn);

            // Add dynamic category buttons from categoryData
            (this.categoryData || []).forEach(cat => {
                const btn = document.createElement('button');
                btn.className = `filter-tab${currentCategory === cat.name ? ' active' : ''}`;
                btn.textContent = cat.name;
                btn.dataset.shopAction = 'product-filter-category';
                btn.dataset.category = cat.name;
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
        const restoredShopState = this.restoreShopUrlState();

        console.log('Admin Shop Init...');
        this.bindDelegatedHandlers();
        this.bindStaticOverlayDismisses();
        this.bindShopContextListeners();
        this.enhanceShopCustomSelects();
        this.ensureRichTextEditors();
        this.ensureDeliveryWorkspaceMounted();

        // Close dropdowns when clicking outside
        document.addEventListener('click', (e) => {
            if (!(e.target instanceof Element) || !e.target.closest('.shop-custom-select')) {
                this.closeShopCustomSelects();
            }

            // Close custom dropdown menu
            const dropdown = document.querySelector('.custom-dropdown');
            const menu = document.querySelector('.custom-dropdown-menu');
            if (e.target instanceof Element && dropdown && menu && !dropdown.contains(e.target) && !menu.contains(e.target)) {
                menu.classList.remove('show');
            }

            // Close category dropdown in product modal
            const categoryDropdown = document.getElementById('prodCategoryDropdown');
            if (e.target instanceof Element && categoryDropdown && !categoryDropdown.contains(e.target)) {
                categoryDropdown.classList.remove('open');
            }
        });

        // Restore the last shop tab/filter context from URL when available.
        this.switchTab(restoredShopState?.tabName || 'products');

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

    ensureDeliveryWorkspaceMounted: function () {
        const mount = document.getElementById('shopDeliveryMount');
        const workspace = document.getElementById('shopDeliveryWorkspace');
        if (!mount || !workspace || workspace.parentElement === mount) return;
        mount.appendChild(workspace);
    },

    getShopUrlObject: function () {
        try {
            return new URL(window.location.href);
        } catch (error) {
            console.warn('[ShopAdmin] Failed to parse current URL:', error);
            return null;
        }
    },

    restoreShopUrlState: function () {
        const url = this.getShopUrlObject();
        const validTabs = new Set(['products', 'import', 'inventory', 'orders', 'fulfillment']);
        if (!url) return { tabName: this.currentTab || 'products' };

        const search = url.searchParams;
        const deliveryMockModeEnabled = ['1', 'true', 'yes', 'on'].includes(String(search.get('deliveryMock') || '').trim().toLowerCase());
        const deliveryQuery = String(search.get('deliveryQuery') || '').trim();
        const deliveryQueryType = String(search.get('deliveryQueryType') || 'manual').trim().toLowerCase();
        const deliveryBucketStartAt = String(search.get('deliveryBucketStartAt') || '').trim();
        const deliveryBucketEndAt = String(search.get('deliveryBucketEndAt') || '').trim();
        const deliveryBucketLabel = String(search.get('deliveryBucketLabel') || '').trim();
        const deliveryFocusTaskId = String(search.get('deliveryFocusTaskId') || '').trim();
        const deliveryFocusOrderId = String(search.get('deliveryFocusOrderId') || '').trim();
        const deliveryFocusAuditId = String(search.get('deliveryFocusAuditId') || '').trim();

        this.deliveryTaskQuery = deliveryQuery;
        this.deliveryMockModeEnabled = deliveryMockModeEnabled;
        if (!deliveryMockModeEnabled) {
            this.deliveryMockStore = null;
        }
        this.deliveryTaskQueryContext = deliveryQuery
            ? {
                type: ['target', 'channel', 'manual'].includes(deliveryQueryType) ? deliveryQueryType : 'manual',
                label: deliveryQuery
            }
            : null;
        this.deliveryConflictBucketFilter = deliveryBucketStartAt && deliveryBucketEndAt
            ? {
                startAt: deliveryBucketStartAt,
                endAt: deliveryBucketEndAt,
                label: deliveryBucketLabel
            }
            : null;
        this.deliveryTaskIdentityFilter = deliveryFocusTaskId || deliveryFocusOrderId
            ? {
                taskId: deliveryFocusTaskId || '',
                orderId: deliveryFocusOrderId || ''
            }
            : null;
        this.deliveryConflictAuditSelection = deliveryFocusAuditId
            ? {
                auditId: deliveryFocusAuditId,
                taskId: deliveryFocusTaskId || '',
                orderId: deliveryFocusOrderId || '',
                createdAt: ''
            }
            : null;
        this.deliveryTaskStatusFilter = String(search.get('deliveryTaskStatus') || 'all').trim().toLowerCase() || 'all';
        this.deliveryDeadLetterReasonFilter = String(search.get('deliveryDeadLetterReason') || 'all').trim().toLowerCase() || 'all';
        this.deliveryLockStateFilter = String(search.get('deliveryLockState') || 'all').trim().toLowerCase() || 'all';
        this.deliveryConflictAuditReasonFilter = this.normalizeDeliveryConflictAuditReasonFilter(search.get('deliveryConflictReason'));
        this.deliveryConflictAuditTargetFilter = String(search.get('deliveryConflictTarget') || '').trim();
        this.deliveryConflictAuditChannelFilter = String(search.get('deliveryConflictChannel') || '').trim();
        this.deliveryAnalyticsWindow = this.getDeliveryAnalyticsWindowConfig(search.get('deliveryAnalyticsWindow')).key;
        this.deliveryPendingTaskReveal = this.deliveryTaskIdentityFilter ? { ...this.deliveryTaskIdentityFilter } : null;
        this.deliveryPendingAuditReveal = deliveryFocusAuditId ? { auditId: deliveryFocusAuditId } : null;

        const explicitTab = String(search.get('shopTab') || '').trim().toLowerCase();
        const hasDeliveryContext = Boolean(
            deliveryQuery
            || this.deliveryConflictBucketFilter
            || this.deliveryTaskIdentityFilter
            || this.deliveryConflictAuditSelection
            || this.deliveryTaskStatusFilter !== 'all'
            || this.deliveryDeadLetterReasonFilter !== 'all'
            || this.deliveryLockStateFilter !== 'all'
            || this.deliveryConflictAuditReasonFilter !== 'all'
            || this.deliveryConflictAuditTargetFilter
            || this.deliveryConflictAuditChannelFilter
            || this.deliveryAnalyticsWindow !== '24h'
            || deliveryMockModeEnabled
        );
        const nextTab = validTabs.has(explicitTab)
            ? explicitTab
            : (hasDeliveryContext ? 'fulfillment' : (this.currentTab || 'products'));
        return { tabName: nextTab };
    },

    syncShopUrlState: function () {
        const url = this.getShopUrlObject();
        if (!url || typeof window.history?.replaceState !== 'function') return;

        const search = url.searchParams;
        this.applyShopUrlStateToSearchParams(search);

        const nextRelativeUrl = `${url.pathname}${url.search}${url.hash}`;
        const currentRelativeUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        if (nextRelativeUrl !== currentRelativeUrl) {
            window.history.replaceState(window.history.state, '', nextRelativeUrl);
        }
    },

    applyShopUrlStateToSearchParams: function (search) {
        if (!search || typeof search.delete !== 'function' || typeof search.set !== 'function') return;

        const setOrDelete = (key, value, defaultValue = '') => {
            const normalized = String(value ?? '').trim();
            const normalizedDefault = String(defaultValue ?? '').trim();
            if (!normalized || normalized === normalizedDefault) {
                search.delete(key);
                return;
            }
            search.set(key, normalized);
        };

        setOrDelete('shopTab', this.currentTab, 'products');
        setOrDelete('deliveryAnalyticsWindow', this.deliveryAnalyticsWindow, '24h');
        setOrDelete('deliveryQuery', this.deliveryTaskQuery, '');
        setOrDelete('deliveryQueryType', this.deliveryTaskQuery ? (this.deliveryTaskQueryContext?.type || 'manual') : '', 'manual');
        setOrDelete('deliveryBucketStartAt', this.deliveryConflictBucketFilter?.startAt || '', '');
        setOrDelete('deliveryBucketEndAt', this.deliveryConflictBucketFilter?.endAt || '', '');
        setOrDelete('deliveryBucketLabel', this.deliveryConflictBucketFilter?.label || '', '');
        setOrDelete('deliveryFocusTaskId', this.deliveryTaskIdentityFilter?.taskId || '', '');
        setOrDelete('deliveryFocusOrderId', this.deliveryTaskIdentityFilter?.orderId || '', '');
        setOrDelete('deliveryFocusAuditId', this.deliveryConflictAuditSelection?.auditId || '', '');
        setOrDelete('deliveryTaskStatus', this.deliveryTaskStatusFilter, 'all');
        setOrDelete('deliveryDeadLetterReason', this.deliveryDeadLetterReasonFilter, 'all');
        setOrDelete('deliveryLockState', this.deliveryLockStateFilter, 'all');
        setOrDelete('deliveryConflictReason', this.deliveryConflictAuditReasonFilter, 'all');
        setOrDelete('deliveryConflictTarget', this.deliveryConflictAuditTargetFilter, '');
        setOrDelete('deliveryConflictChannel', this.deliveryConflictAuditChannelFilter, '');
        setOrDelete('deliveryMock', this.deliveryMockModeEnabled ? '1' : '', '');
    },

    buildDeliveryRestoreUrl: function () {
        const currentUrl = this.getShopUrlObject();
        if (!currentUrl) return '';

        const restoreUrl = new URL(currentUrl.pathname, currentUrl.origin);
        restoreUrl.hash = currentUrl.hash;
        restoreUrl.searchParams.set('module', 'shop');
        this.applyShopUrlStateToSearchParams(restoreUrl.searchParams);
        return restoreUrl.toString();
    },

    isDeliveryMockModeEnabled: function () {
        return this.deliveryMockModeEnabled === true;
    },

    getDeliveryMockModeNote: function () {
        if (!this.isDeliveryMockModeEnabled()) return '';
        return '当前为模拟验收模式，履约任务、冲突趋势、人工动作和策略保存都只在当前浏览器会话内演练，不会写入后台。';
    },

    cloneDeliveryMockValue: function (value) {
        return JSON.parse(JSON.stringify(value));
    },

    getDeliveryMockConflictReasonMeta: function (reasonKey = 'unknown_conflict') {
        const normalized = String(reasonKey || '').trim().toLowerCase();
        const map = {
            target_max_inflight: { key: 'target_max_inflight', label: '目标并发打满', tone: 'warn' },
            target_min_interval: { key: 'target_min_interval', label: '目标触发间隔限流', tone: 'warn' },
            channel_max_inflight: { key: 'channel_max_inflight', label: '通道并发打满', tone: 'danger' },
            channel_min_interval: { key: 'channel_min_interval', label: '通道触发间隔限流', tone: 'warn' },
            manual_force_unlock: { key: 'manual_force_unlock', label: '人工强制解锁', tone: 'processing' },
            unknown_conflict: { key: 'unknown_conflict', label: '其他冲突', tone: 'muted' }
        };
        return map[normalized] || map.unknown_conflict;
    },

    buildDeliveryMockStore: function () {
        const now = Date.now();
        const isoMinutes = (offsetMinutes) => new Date(now + offsetMinutes * 60 * 1000).toISOString();
        const isoHours = (offsetHours) => new Date(now + offsetHours * 60 * 60 * 1000).toISOString();
        const reasonMeta = (reasonKey) => this.getDeliveryMockConflictReasonMeta(reasonKey);
        const createOrder = ({ id, userId, productName, deliveryStatus, createdAt, refunded = false }) => ({
            id,
            user_id: userId,
            snapshot_product_name: productName,
            price_paid: 49,
            total_price: 49,
            delivery_status: deliveryStatus,
            delivery_attempt_count: 1,
            delivery_last_error: null,
            delivery_completed_at: deliveryStatus === 'delivered' ? isoHours(-2) : null,
            created_at: createdAt,
            item_count: 1,
            refund_status: refunded ? 'full_refund' : 'none'
        });

        const tasks = [
            {
                id: 'mock-task-001',
                order_id: 'MOCK-ORD-001',
                order: createOrder({
                    id: 'MOCK-ORD-001',
                    userId: 'user_alice',
                    productName: 'GPT Plus API 发货',
                    deliveryStatus: 'pending',
                    createdAt: isoHours(-6)
                }),
                target_url: 'https://api.vendor-a.com/fulfill/gpt-plus',
                payload: { sku: 'gpt-plus', account: 'alice@example.com' },
                status: 'pending',
                attempt_count: 0,
                max_attempts: 5,
                next_attempt_at: isoMinutes(5),
                last_attempt_at: null,
                last_error: null,
                last_response_status: null,
                last_response_body: null,
                dedupe_key: 'mock:delivery:001',
                target_key: 'user:alice@example.com',
                channel_key: 'api.vendor-a.com',
                worker_name: null,
                conflict_count: 0,
                last_conflict_at: null,
                last_conflict_reason: null,
                last_conflict_scope: null,
                last_conflict_note: null,
                delivered_at: null,
                dead_lettered_at: null,
                dead_letter_reason: null,
                manual_replay_requested_at: null,
                manual_replay_requested_by: null,
                manual_replay_count: 0,
                locked_at: null,
                lock_expires_at: null,
                lock_token: null,
                reservation_acquired_at: null,
                reservation_lock_token: null,
                reservation_worker_name: null,
                executed_at: null,
                updated_at: isoMinutes(-18),
                created_at: isoHours(-6),
                attempts: [],
                lock_state: 'unlocked',
                reservation_state: { key: 'none', label: '无占位', tone: 'muted' }
            },
            {
                id: 'mock-task-002',
                order_id: 'MOCK-ORD-002',
                order: createOrder({
                    id: 'MOCK-ORD-002',
                    userId: 'user_bob',
                    productName: 'Claude Pro API 发货',
                    deliveryStatus: 'processing',
                    createdAt: isoHours(-4)
                }),
                target_url: 'https://api.vendor-a.com/fulfill/claude-pro',
                payload: { sku: 'claude-pro', account: 'bob@example.com' },
                status: 'processing',
                attempt_count: 1,
                max_attempts: 5,
                next_attempt_at: isoMinutes(2),
                last_attempt_at: isoMinutes(-6),
                last_error: '正在等待目标并发槽位释放',
                last_response_status: 202,
                last_response_body: 'processing',
                dedupe_key: 'mock:delivery:002',
                target_key: 'user:bob@example.com',
                channel_key: 'api.vendor-a.com',
                worker_name: 'worker-a',
                conflict_count: 2,
                last_conflict_at: isoMinutes(-82),
                last_conflict_reason: 'target_max_inflight',
                last_conflict_scope: 'target',
                last_conflict_note: '目标并发已满，等待释放后继续执行',
                delivered_at: null,
                dead_lettered_at: null,
                dead_letter_reason: null,
                manual_replay_requested_at: null,
                manual_replay_requested_by: null,
                manual_replay_count: 0,
                locked_at: isoMinutes(-3),
                lock_expires_at: isoMinutes(9),
                lock_token: 'lock-mock-002',
                reservation_acquired_at: isoMinutes(-3),
                reservation_lock_token: 'lock-mock-002',
                reservation_worker_name: 'worker-a',
                executed_at: isoMinutes(-6),
                updated_at: isoMinutes(-2),
                created_at: isoHours(-4),
                attempts: [
                    {
                        id: 'mock-attempt-002-1',
                        task_id: 'mock-task-002',
                        attempt_no: 1,
                        worker_name: 'worker-a',
                        started_at: isoMinutes(-6),
                        finished_at: isoMinutes(-6),
                        success: false,
                        response_status: 202,
                        error_message: '目标并发已满',
                        duration_ms: 980
                    }
                ],
                lock_state: 'locked_active',
                reservation_state: { key: 'active', label: '全局占位生效', tone: 'processing' }
            },
            {
                id: 'mock-task-003',
                order_id: 'MOCK-ORD-003',
                order: createOrder({
                    id: 'MOCK-ORD-003',
                    userId: 'user_charlie',
                    productName: 'Midjourney API 发货',
                    deliveryStatus: 'retry_waiting',
                    createdAt: isoHours(-8)
                }),
                target_url: 'https://api.vendor-a.com/fulfill/midjourney',
                payload: { sku: 'midjourney', account: 'charlie@example.com' },
                status: 'retry_waiting',
                attempt_count: 2,
                max_attempts: 5,
                next_attempt_at: isoMinutes(8),
                last_attempt_at: isoMinutes(-16),
                last_error: '上游请求超时，已进入退避重试',
                last_response_status: 504,
                last_response_body: 'gateway timeout',
                dedupe_key: 'mock:delivery:003',
                target_key: 'user:charlie@example.com',
                channel_key: 'api.vendor-a.com',
                worker_name: 'worker-a',
                conflict_count: 1,
                last_conflict_at: isoMinutes(-38),
                last_conflict_reason: 'target_min_interval',
                last_conflict_scope: 'target',
                last_conflict_note: '目标触发间隔限流',
                delivered_at: null,
                dead_lettered_at: null,
                dead_letter_reason: null,
                manual_replay_requested_at: null,
                manual_replay_requested_by: null,
                manual_replay_count: 0,
                locked_at: null,
                lock_expires_at: null,
                lock_token: null,
                reservation_acquired_at: null,
                reservation_lock_token: null,
                reservation_worker_name: null,
                executed_at: isoMinutes(-16),
                updated_at: isoMinutes(-10),
                created_at: isoHours(-8),
                attempts: [
                    {
                        id: 'mock-attempt-003-1',
                        task_id: 'mock-task-003',
                        attempt_no: 1,
                        worker_name: 'worker-a',
                        started_at: isoMinutes(-45),
                        finished_at: isoMinutes(-45),
                        success: false,
                        response_status: 429,
                        error_message: '目标触发间隔限流',
                        duration_ms: 740
                    },
                    {
                        id: 'mock-attempt-003-2',
                        task_id: 'mock-task-003',
                        attempt_no: 2,
                        worker_name: 'worker-a',
                        started_at: isoMinutes(-16),
                        finished_at: isoMinutes(-15),
                        success: false,
                        response_status: 504,
                        error_message: '请求超时',
                        duration_ms: 15024
                    }
                ],
                lock_state: 'unlocked',
                reservation_state: { key: 'none', label: '无占位', tone: 'muted' }
            },
            {
                id: 'mock-task-004',
                order_id: 'MOCK-ORD-004',
                order: createOrder({
                    id: 'MOCK-ORD-004',
                    userId: 'user_dana',
                    productName: 'Discord Nitro API 发货',
                    deliveryStatus: 'dead_letter',
                    createdAt: isoHours(-20)
                }),
                target_url: 'https://api.vendor-b.com/fulfill/nitro',
                payload: { sku: 'nitro', account: 'region-hk' },
                status: 'dead_letter',
                attempt_count: 5,
                max_attempts: 5,
                next_attempt_at: null,
                last_attempt_at: isoMinutes(-28),
                last_error: '通道并发长期冲突，已按冲突策略转死信',
                last_response_status: 429,
                last_response_body: 'channel saturated',
                dedupe_key: 'mock:delivery:004',
                target_key: 'shop:region-hk',
                channel_key: 'api.vendor-b.com',
                worker_name: 'worker-b',
                conflict_count: 6,
                last_conflict_at: isoMinutes(-28),
                last_conflict_reason: 'channel_max_inflight',
                last_conflict_scope: 'channel',
                last_conflict_note: '通道并发打满后转死信',
                delivered_at: null,
                dead_lettered_at: isoMinutes(-26),
                dead_letter_reason: 'conflict_strategy',
                manual_replay_requested_at: isoMinutes(-56),
                manual_replay_requested_by: 'ops.mock@example.com',
                manual_replay_count: 1,
                locked_at: null,
                lock_expires_at: null,
                lock_token: null,
                reservation_acquired_at: null,
                reservation_lock_token: null,
                reservation_worker_name: null,
                executed_at: isoMinutes(-28),
                updated_at: isoMinutes(-26),
                created_at: isoHours(-20),
                attempts: [
                    {
                        id: 'mock-attempt-004-5',
                        task_id: 'mock-task-004',
                        attempt_no: 5,
                        worker_name: 'worker-b',
                        started_at: isoMinutes(-28),
                        finished_at: isoMinutes(-28),
                        success: false,
                        response_status: 429,
                        error_message: '通道并发打满',
                        duration_ms: 860
                    }
                ],
                lock_state: 'unlocked',
                reservation_state: { key: 'none', label: '无占位', tone: 'muted' }
            },
            {
                id: 'mock-task-005',
                order_id: 'MOCK-ORD-005',
                order: createOrder({
                    id: 'MOCK-ORD-005',
                    userId: 'user_erin',
                    productName: 'Perplexity API 发货',
                    deliveryStatus: 'delivered',
                    createdAt: isoHours(-32)
                }),
                target_url: 'https://api.vendor-c.com/fulfill/perplexity',
                payload: { sku: 'perplexity', account: 'erin@example.com' },
                status: 'delivered',
                attempt_count: 1,
                max_attempts: 5,
                next_attempt_at: null,
                last_attempt_at: isoHours(-2),
                last_error: null,
                last_response_status: 200,
                last_response_body: 'ok',
                dedupe_key: 'mock:delivery:005',
                target_key: 'user:erin@example.com',
                channel_key: 'api.vendor-c.com',
                worker_name: 'worker-c',
                conflict_count: 0,
                last_conflict_at: null,
                last_conflict_reason: null,
                last_conflict_scope: null,
                last_conflict_note: null,
                delivered_at: isoHours(-2),
                dead_lettered_at: null,
                dead_letter_reason: null,
                manual_replay_requested_at: null,
                manual_replay_requested_by: null,
                manual_replay_count: 0,
                locked_at: null,
                lock_expires_at: null,
                lock_token: null,
                reservation_acquired_at: null,
                reservation_lock_token: null,
                reservation_worker_name: null,
                executed_at: isoHours(-2),
                updated_at: isoHours(-2),
                created_at: isoHours(-32),
                attempts: [
                    {
                        id: 'mock-attempt-005-1',
                        task_id: 'mock-task-005',
                        attempt_no: 1,
                        worker_name: 'worker-c',
                        started_at: isoHours(-2),
                        finished_at: isoHours(-2),
                        success: true,
                        response_status: 200,
                        error_message: null,
                        duration_ms: 642
                    }
                ],
                lock_state: 'unlocked',
                reservation_state: { key: 'none', label: '无占位', tone: 'muted' }
            },
            {
                id: 'mock-task-006',
                order_id: 'MOCK-ORD-006',
                order: createOrder({
                    id: 'MOCK-ORD-006',
                    userId: 'user_frank',
                    productName: 'Notion AI API 发货',
                    deliveryStatus: 'processing',
                    createdAt: isoHours(-14)
                }),
                target_url: 'https://api.vendor-b.com/fulfill/notion-ai',
                payload: { sku: 'notion-ai', account: 'frank@example.com' },
                status: 'processing',
                attempt_count: 3,
                max_attempts: 5,
                next_attempt_at: isoMinutes(4),
                last_attempt_at: isoMinutes(-22),
                last_error: 'reservation 锁 token 与当前处理锁不一致',
                last_response_status: 409,
                last_response_body: 'lock token mismatch',
                dedupe_key: 'mock:delivery:006',
                target_key: 'user:frank@example.com',
                channel_key: 'api.vendor-b.com',
                worker_name: 'worker-b',
                conflict_count: 3,
                last_conflict_at: isoMinutes(-18),
                last_conflict_reason: 'manual_force_unlock',
                last_conflict_scope: 'manual',
                last_conflict_note: '人工清理过期占位后等待重新执行',
                delivered_at: null,
                dead_lettered_at: null,
                dead_letter_reason: null,
                manual_replay_requested_at: null,
                manual_replay_requested_by: null,
                manual_replay_count: 0,
                locked_at: isoMinutes(-25),
                lock_expires_at: isoMinutes(-12),
                lock_token: 'lock-current-006',
                reservation_acquired_at: isoMinutes(-25),
                reservation_lock_token: 'lock-stale-006',
                reservation_worker_name: 'worker-zombie',
                executed_at: isoMinutes(-22),
                updated_at: isoMinutes(-18),
                created_at: isoHours(-14),
                attempts: [
                    {
                        id: 'mock-attempt-006-3',
                        task_id: 'mock-task-006',
                        attempt_no: 3,
                        worker_name: 'worker-b',
                        started_at: isoMinutes(-22),
                        finished_at: isoMinutes(-22),
                        success: false,
                        response_status: 409,
                        error_message: 'lock token mismatch',
                        duration_ms: 512
                    }
                ],
                lock_state: 'locked_stale',
                reservation_state: { key: 'token_drift', label: 'Token 漂移', tone: 'danger' }
            },
            {
                id: 'mock-task-007',
                order_id: 'MOCK-ORD-007',
                order: createOrder({
                    id: 'MOCK-ORD-007',
                    userId: 'user_grace',
                    productName: 'Canva API 发货',
                    deliveryStatus: 'requeued',
                    createdAt: isoHours(-18)
                }),
                target_url: 'https://api.vendor-a.com/fulfill/canva',
                payload: { sku: 'canva', account: 'grace@example.com' },
                status: 'requeued',
                attempt_count: 2,
                max_attempts: 5,
                next_attempt_at: isoMinutes(3),
                last_attempt_at: isoMinutes(-14),
                last_error: '人工重放后重新入队，等待通道窗口',
                last_response_status: 202,
                last_response_body: 'requeued',
                dedupe_key: 'mock:delivery:007',
                target_key: 'user:grace@example.com',
                channel_key: 'api.vendor-a.com',
                worker_name: null,
                conflict_count: 1,
                last_conflict_at: isoHours(-10),
                last_conflict_reason: 'channel_min_interval',
                last_conflict_scope: 'channel',
                last_conflict_note: '人工重放后继续等待通道窗口',
                delivered_at: null,
                dead_lettered_at: null,
                dead_letter_reason: null,
                manual_replay_requested_at: isoMinutes(-14),
                manual_replay_requested_by: 'ops.mock@example.com',
                manual_replay_count: 2,
                locked_at: null,
                lock_expires_at: null,
                lock_token: null,
                reservation_acquired_at: isoMinutes(-14),
                reservation_lock_token: null,
                reservation_worker_name: null,
                executed_at: isoMinutes(-14),
                updated_at: isoMinutes(-11),
                created_at: isoHours(-18),
                attempts: [
                    {
                        id: 'mock-attempt-007-2',
                        task_id: 'mock-task-007',
                        attempt_no: 2,
                        worker_name: 'worker-a',
                        started_at: isoMinutes(-14),
                        finished_at: isoMinutes(-14),
                        success: false,
                        response_status: 202,
                        error_message: '人工重放后重新入队',
                        duration_ms: 420
                    }
                ],
                lock_state: 'unlocked',
                reservation_state: { key: 'released_pending_cleanup', label: '占位残留', tone: 'warn' }
            },
            {
                id: 'mock-task-008',
                order_id: 'MOCK-ORD-008',
                order: createOrder({
                    id: 'MOCK-ORD-008',
                    userId: 'user_henry',
                    productName: 'Cursor API 发货',
                    deliveryStatus: 'dead_letter',
                    createdAt: isoHours(-12)
                }),
                target_url: '',
                payload: { sku: 'cursor', account: 'henry@example.com' },
                status: 'dead_letter',
                attempt_count: 1,
                max_attempts: 5,
                next_attempt_at: null,
                last_attempt_at: isoHours(-11),
                last_error: '目标地址为空，无法发货',
                last_response_status: null,
                last_response_body: null,
                dedupe_key: 'mock:delivery:008',
                target_key: '',
                channel_key: 'api.vendor-c.com',
                worker_name: null,
                conflict_count: 0,
                last_conflict_at: null,
                last_conflict_reason: null,
                last_conflict_scope: null,
                last_conflict_note: null,
                delivered_at: null,
                dead_lettered_at: isoHours(-11),
                dead_letter_reason: 'missing_target',
                manual_replay_requested_at: null,
                manual_replay_requested_by: null,
                manual_replay_count: 0,
                locked_at: null,
                lock_expires_at: null,
                lock_token: null,
                reservation_acquired_at: null,
                reservation_lock_token: null,
                reservation_worker_name: null,
                executed_at: isoHours(-11),
                updated_at: isoHours(-11),
                created_at: isoHours(-12),
                attempts: [
                    {
                        id: 'mock-attempt-008-1',
                        task_id: 'mock-task-008',
                        attempt_no: 1,
                        worker_name: 'worker-c',
                        started_at: isoHours(-11),
                        finished_at: isoHours(-11),
                        success: false,
                        response_status: null,
                        error_message: '目标地址为空',
                        duration_ms: 112
                    }
                ],
                lock_state: 'unlocked',
                reservation_state: { key: 'none', label: '无占位', tone: 'muted' }
            }
        ];

        const conflictRecords = [
            { id: 'mock-conflict-001', task_id: 'mock-task-002', order_id: 'MOCK-ORD-002', scope: 'target', reason_key: 'target_max_inflight', detail: '目标并发已满，延后执行', target_key: 'user:bob@example.com', channel_key: 'api.vendor-a.com', worker_name: 'worker-a', lock_token: 'lock-mock-002', task_status: 'processing', next_attempt_at: isoMinutes(2), created_at: isoMinutes(-90) },
            { id: 'mock-conflict-002', task_id: 'mock-task-002', order_id: 'MOCK-ORD-002', scope: 'channel', reason_key: 'channel_min_interval', detail: '通道冷却窗口未结束', target_key: 'user:bob@example.com', channel_key: 'api.vendor-a.com', worker_name: 'worker-a', lock_token: 'lock-mock-002', task_status: 'processing', next_attempt_at: isoMinutes(2), created_at: isoMinutes(-82) },
            { id: 'mock-conflict-003', task_id: 'mock-task-003', order_id: 'MOCK-ORD-003', scope: 'target', reason_key: 'target_min_interval', detail: '同目标两次调用间隔过短', target_key: 'user:charlie@example.com', channel_key: 'api.vendor-a.com', worker_name: 'worker-a', lock_token: null, task_status: 'retry_waiting', next_attempt_at: isoMinutes(8), created_at: isoMinutes(-38) },
            { id: 'mock-conflict-004', task_id: 'mock-task-004', order_id: 'MOCK-ORD-004', scope: 'channel', reason_key: 'channel_max_inflight', detail: '通道并发连续打满，触发死信策略', target_key: 'shop:region-hk', channel_key: 'api.vendor-b.com', worker_name: 'worker-b', lock_token: null, task_status: 'dead_letter', next_attempt_at: null, created_at: isoMinutes(-28) },
            { id: 'mock-conflict-005', task_id: 'mock-task-004', order_id: 'MOCK-ORD-004', scope: 'channel', reason_key: 'channel_max_inflight', detail: '同通道短时间内再次冲突', target_key: 'shop:region-hk', channel_key: 'api.vendor-b.com', worker_name: 'worker-b', lock_token: null, task_status: 'dead_letter', next_attempt_at: null, created_at: isoHours(-3) },
            { id: 'mock-conflict-006', task_id: 'mock-task-004', order_id: 'MOCK-ORD-004', scope: 'channel', reason_key: 'channel_max_inflight', detail: '通道热点持续升温', target_key: 'shop:region-hk', channel_key: 'api.vendor-b.com', worker_name: 'worker-b', lock_token: null, task_status: 'dead_letter', next_attempt_at: null, created_at: isoHours(-6) },
            { id: 'mock-conflict-007', task_id: 'mock-task-006', order_id: 'MOCK-ORD-006', scope: 'manual', reason_key: 'manual_force_unlock', detail: '人工强制解锁 stale reservation', target_key: 'user:frank@example.com', channel_key: 'api.vendor-b.com', worker_name: 'ops.mock@example.com', lock_token: 'lock-stale-006', task_status: 'processing', next_attempt_at: isoMinutes(4), created_at: isoMinutes(-18) },
            { id: 'mock-conflict-008', task_id: 'mock-task-006', order_id: 'MOCK-ORD-006', scope: 'target', reason_key: 'target_max_inflight', detail: '目标并发在多实例下被抢占', target_key: 'user:frank@example.com', channel_key: 'api.vendor-b.com', worker_name: 'worker-zombie', lock_token: 'lock-stale-006', task_status: 'processing', next_attempt_at: isoMinutes(4), created_at: isoHours(-26) },
            { id: 'mock-conflict-009', task_id: 'mock-task-007', order_id: 'MOCK-ORD-007', scope: 'channel', reason_key: 'channel_min_interval', detail: '人工重放后仍需等待通道窗口', target_key: 'user:grace@example.com', channel_key: 'api.vendor-a.com', worker_name: 'worker-a', lock_token: null, task_status: 'requeued', next_attempt_at: isoMinutes(3), created_at: isoMinutes(-14) },
            { id: 'mock-conflict-010', task_id: 'mock-task-007', order_id: 'MOCK-ORD-007', scope: 'manual', reason_key: 'manual_force_unlock', detail: '人工干预后重新排队', target_key: 'user:grace@example.com', channel_key: 'api.vendor-a.com', worker_name: 'ops.mock@example.com', lock_token: null, task_status: 'requeued', next_attempt_at: isoMinutes(3), created_at: isoHours(-10) },
            { id: 'mock-conflict-011', task_id: 'mock-task-004', order_id: 'MOCK-ORD-004', scope: 'channel', reason_key: 'channel_max_inflight', detail: '近 72h 热通道仍有冲突残留', target_key: 'shop:region-hk', channel_key: 'api.vendor-b.com', worker_name: 'worker-b', lock_token: null, task_status: 'dead_letter', next_attempt_at: null, created_at: isoHours(-60) },
            { id: 'mock-conflict-012', task_id: 'mock-task-008', order_id: 'MOCK-ORD-008', scope: 'target', reason_key: 'unknown_conflict', detail: '历史异常样例，用于 7d 趋势验证', target_key: 'user:henry@example.com', channel_key: 'api.vendor-c.com', worker_name: 'worker-c', lock_token: null, task_status: 'dead_letter', next_attempt_at: null, created_at: isoHours(-140) }
        ].map((record) => ({
            ...record,
            strategy_snapshot: {
                worker_parallelism: 2,
                target_max_inflight: 1,
                channel_max_inflight: 2,
                conflict_backoff_seconds: 45
            }
        }));

        const replayRecords = [
            {
                id: 'mock-replay-001',
                created_at: isoMinutes(-14),
                admin_id: 'admin-mock-1',
                admin_email: 'ops.mock@example.com',
                task_id: 'mock-task-007',
                order_id: 'MOCK-ORD-007',
                previous_status: 'retry_waiting',
                next_status: 'requeued',
                note: '人工确认通道恢复后重新排队'
            },
            {
                id: 'mock-replay-002',
                created_at: isoHours(-8),
                admin_id: 'admin-mock-2',
                admin_email: 'qa.mock@example.com',
                task_id: 'mock-task-004',
                order_id: 'MOCK-ORD-004',
                previous_status: 'dead_letter',
                next_status: 'requeued',
                note: '模拟验收：死信回放'
            },
            {
                id: 'mock-replay-003',
                created_at: isoHours(-3),
                admin_id: 'admin-mock-1',
                admin_email: 'ops.mock@example.com',
                task_id: 'mock-task-002',
                order_id: 'MOCK-ORD-002',
                previous_status: 'retry_waiting',
                next_status: 'processing',
                note: '人工触发二次尝试'
            }
        ];

        return {
            strategy: {
                max_attempts: 5,
                sweep_interval_ms: 10000,
                sweep_batch_size: 10,
                worker_parallelism: 2,
                lease_seconds: 120,
                http_timeout_ms: 15000,
                base_backoff_seconds: 30,
                max_backoff_seconds: 1800,
                target_min_interval_ms: 6000,
                target_max_inflight: 1,
                channel_min_interval_ms: 4000,
                channel_max_inflight: 2,
                conflict_backoff_seconds: 45,
                conflict_dead_letter_threshold: 5
            },
            tasks,
            conflictRecords: conflictRecords.map((record) => ({
                ...record,
                conflict_reason: reasonMeta(record.reason_key)
            })),
            replayRecords,
            nextReplayId: 4,
            nextConflictId: 13
        };
    },

    ensureDeliveryMockStore: function () {
        if (!this.deliveryMockStore) {
            this.deliveryMockStore = this.buildDeliveryMockStore();
        }
        return this.deliveryMockStore;
    },

    paginateDeliveryMockRows: function (rows = [], page = 1, pageSize = 20) {
        const normalizedPageSize = Math.max(1, Number(pageSize || 20));
        const normalizedPage = Math.max(1, Number(page || 1));
        const total = rows.length;
        const start = (normalizedPage - 1) * normalizedPageSize;
        return {
            page: normalizedPage,
            pageSize: normalizedPageSize,
            total,
            rows: rows.slice(start, start + normalizedPageSize)
        };
    },

    matchesDeliveryMockTaskIdentity: function (task = {}, identity = null) {
        if (!identity) return true;
        const taskId = String(task.id || '').trim();
        const orderId = String(task.order_id || '').trim();
        if (identity.taskId && taskId !== String(identity.taskId || '').trim()) return false;
        if (identity.orderId && orderId !== String(identity.orderId || '').trim()) return false;
        return true;
    },

    matchesDeliveryMockTaskQuery: function (task = {}, query = '') {
        const normalized = String(query || '').trim().toLowerCase();
        if (!normalized) return true;
        const haystack = [
            task.id,
            task.order_id,
            task.target_url,
            task.target_key,
            task.channel_key,
            task.dedupe_key,
            task.worker_name,
            task.last_error,
            task.last_conflict_reason,
            task.last_conflict_note,
            task.order?.snapshot_product_name,
            task.order?.user_id,
            task.dead_letter_reason
        ]
            .map((value) => String(value || '').toLowerCase())
            .filter(Boolean)
            .join('\n');
        return haystack.includes(normalized);
    },

    matchesDeliveryMockConflictReason: function (record = {}, reasonFilter = 'all') {
        const normalized = this.normalizeDeliveryConflictAuditReasonFilter(reasonFilter);
        const reasonKey = String(record.reason_key || '').trim().toLowerCase();
        if (normalized === 'all') return true;
        if (normalized === 'target_conflicts') return ['target_max_inflight', 'target_min_interval'].includes(reasonKey);
        if (normalized === 'channel_conflicts') return ['channel_max_inflight', 'channel_min_interval'].includes(reasonKey);
        return reasonKey === normalized;
    },

    matchesDeliveryMockConflictBucket: function (record = {}, bucket = null) {
        if (!bucket?.startAt || !bucket?.endAt) return true;
        const createdAt = new Date(record.created_at || 0).getTime();
        const startAt = new Date(bucket.startAt || 0).getTime();
        const endAt = new Date(bucket.endAt || 0).getTime();
        if (!Number.isFinite(createdAt) || !Number.isFinite(startAt) || !Number.isFinite(endAt)) return false;
        return createdAt >= startAt && createdAt < endAt;
    },

    matchesDeliveryMockConflictQuery: function (record = {}, query = '') {
        const normalized = String(query || '').trim().toLowerCase();
        if (!normalized) return true;
        const haystack = [
            record.id,
            record.task_id,
            record.order_id,
            record.detail,
            record.target_key,
            record.channel_key,
            record.reason_key,
            record.worker_name,
            record.task?.order?.snapshot_product_name,
            record.task?.order?.user_id
        ]
            .map((value) => String(value || '').toLowerCase())
            .filter(Boolean)
            .join('\n');
        return haystack.includes(normalized);
    },

    matchesDeliveryMockDeadLetterReason: function (task = {}, reason = 'all') {
        const normalized = String(reason || 'all').trim().toLowerCase();
        if (normalized === 'all') return true;
        return String(task.dead_letter_reason || '').trim().toLowerCase() === normalized;
    },

    matchesDeliveryMockLockState: function (task = {}, lockState = 'all') {
        const normalized = String(lockState || 'all').trim().toLowerCase();
        const taskLockState = String(task.lock_state || '').trim().toLowerCase();
        if (normalized === 'all') {
            return ['locked_active', 'locked_stale', 'lock_missing', 'locked_unknown'].includes(taskLockState);
        }
        if (normalized === 'active') return taskLockState === 'locked_active';
        if (normalized === 'stale') return ['locked_stale', 'lock_missing', 'locked_unknown'].includes(taskLockState);
        return true;
    },

    hasDeliveryMockReservationSnapshot: function (task = {}) {
        const reservationStateKey = String(task.reservation_state?.key || '').trim().toLowerCase();
        return reservationStateKey && reservationStateKey !== 'none';
    },

    buildDeliveryMockAnalyticsWindowRange: function (windowKey = '24h') {
        const config = this.getDeliveryAnalyticsWindowConfig(windowKey);
        const bucketHours = Math.max(1, Number(config.bucketHours || 1));
        const bucketCount = Math.max(1, Math.ceil(Number(config.hours || 24) / bucketHours));
        const end = new Date();
        end.setMinutes(0, 0, 0);
        end.setHours(end.getHours() - (end.getHours() % bucketHours), 0, 0, 0);
        const start = new Date(end.getTime() - (bucketCount - 1) * bucketHours * 60 * 60 * 1000);

        return {
            key: config.key,
            label: config.label,
            description: config.description,
            hours: Number(config.hours || 24),
            bucket_hours: bucketHours,
            bucket_count: bucketCount,
            start_at: start.toISOString(),
            end_at: end.toISOString()
        };
    },

    buildDeliveryMockConflictAnalytics: function (records = [], reservationTasks = [], windowKey = '24h') {
        const range = this.buildDeliveryMockAnalyticsWindowRange(windowKey);
        const bucketHours = Math.max(1, Number(range.bucket_hours || 1));
        const bucketCount = Math.max(1, Number(range.bucket_count || 1));
        const bucketMs = bucketHours * 60 * 60 * 1000;
        const startAtMs = new Date(range.start_at).getTime();
        const buckets = Array.from({ length: bucketCount }, (_, index) => {
            const bucketAt = new Date(startAtMs + index * bucketMs);
            return {
                bucket_at: bucketAt.toISOString(),
                bucket_end_at: new Date(bucketAt.getTime() + bucketMs).toISOString(),
                label: bucketHours >= 24
                    ? `${String(bucketAt.getMonth() + 1).padStart(2, '0')}-${String(bucketAt.getDate()).padStart(2, '0')}`
                    : `${String(bucketAt.getMonth() + 1).padStart(2, '0')}-${String(bucketAt.getDate()).padStart(2, '0')} ${String(bucketAt.getHours()).padStart(2, '0')}:00`,
                total: 0,
                target: 0,
                channel: 0,
                manual: 0,
                dead_letter: 0
            };
        });

        const inWindowRecords = records.filter((record) => {
            const createdAt = new Date(record.created_at || 0).getTime();
            return Number.isFinite(createdAt) && createdAt >= startAtMs && createdAt < (new Date(range.end_at).getTime() + bucketMs);
        });

        inWindowRecords.forEach((record) => {
            const createdAt = new Date(record.created_at || 0).getTime();
            const bucketIndex = Math.floor((createdAt - startAtMs) / bucketMs);
            const bucket = buckets[bucketIndex];
            if (!bucket) return;
            bucket.total += 1;
            const scope = String(record.scope || '').trim().toLowerCase();
            if (scope === 'target') bucket.target += 1;
            if (scope === 'channel') bucket.channel += 1;
            if (scope === 'manual') bucket.manual += 1;
            if (String(record.task_status || '').trim().toLowerCase() === 'dead_letter') bucket.dead_letter += 1;
        });

        const totals = buckets.reduce((acc, bucket) => {
            acc.total_conflicts += Number(bucket.total || 0);
            acc.target_conflicts += Number(bucket.target || 0);
            acc.channel_conflicts += Number(bucket.channel || 0);
            acc.manual_conflicts += Number(bucket.manual || 0);
            acc.dead_letter_conflicts += Number(bucket.dead_letter || 0);
            return acc;
        }, {
            total_conflicts: 0,
            target_conflicts: 0,
            channel_conflicts: 0,
            manual_conflicts: 0,
            dead_letter_conflicts: 0
        });

        const hottestBucket = buckets.reduce((current, bucket) => (
            Number(bucket.total || 0) > Number(current?.total || 0) ? bucket : current
        ), null);
        const buildHotspots = (keyField) => {
            const map = new Map();
            inWindowRecords.forEach((record) => {
                const key = String(record[keyField] || '').trim().toLowerCase();
                if (!key) return;
                if (!map.has(key)) {
                    map.set(key, {
                        key,
                        total_conflicts: 0,
                        dead_letter_count: 0,
                        manual_count: 0,
                        active_reservations: 0,
                        latest_at: null,
                        latest_reason_key: null,
                        latest_reason_label: null
                    });
                }
                const item = map.get(key);
                item.total_conflicts += 1;
                if (String(record.task_status || '').trim().toLowerCase() === 'dead_letter') item.dead_letter_count += 1;
                if (String(record.scope || '').trim().toLowerCase() === 'manual') item.manual_count += 1;
                if (!item.latest_at || new Date(record.created_at || 0).getTime() > new Date(item.latest_at || 0).getTime()) {
                    item.latest_at = record.created_at;
                    item.latest_reason_key = record.reason_key;
                    item.latest_reason_label = this.getDeliveryMockConflictReasonMeta(record.reason_key).label;
                }
            });

            reservationTasks.forEach((task) => {
                if (String(task.reservation_state?.key || '').trim().toLowerCase() !== 'active') return;
                const key = String(task[keyField] || '').trim().toLowerCase();
                if (!key) return;
                if (!map.has(key)) {
                    map.set(key, {
                        key,
                        total_conflicts: 0,
                        dead_letter_count: 0,
                        manual_count: 0,
                        active_reservations: 0,
                        latest_at: null,
                        latest_reason_key: null,
                        latest_reason_label: null
                    });
                }
                map.get(key).active_reservations += 1;
            });

            return [...map.values()]
                .sort((left, right) => (
                    Number(right.total_conflicts || 0) - Number(left.total_conflicts || 0)
                    || Number(right.active_reservations || 0) - Number(left.active_reservations || 0)
                ))
                .slice(0, 6);
        };

        return {
            window: {
                key: range.key,
                label: range.label,
                description: range.description,
                hours: range.hours,
                bucket_hours: range.bucket_hours,
                bucket_count: range.bucket_count,
                start_at: range.start_at,
                end_at: range.end_at
            },
            summary: {
                window_key: range.key,
                window_label: range.label,
                window_description: range.description,
                hours: range.hours,
                bucket_hours: range.bucket_hours,
                bucket_count: range.bucket_count,
                total_conflicts: totals.total_conflicts,
                target_conflicts: totals.target_conflicts,
                channel_conflicts: totals.channel_conflicts,
                manual_conflicts: totals.manual_conflicts,
                dead_letter_conflicts: totals.dead_letter_conflicts,
                hottest_hour_label: hottestBucket?.label || null,
                hottest_hour_total: Number(hottestBucket?.total || 0),
                target_hotspots: buildHotspots('target_key').length,
                channel_hotspots: buildHotspots('channel_key').length
            },
            trend: {
                window_key: range.key,
                window_label: range.label,
                window_description: range.description,
                hours: range.hours,
                bucket_hours: range.bucket_hours,
                bucket_count: range.bucket_count,
                range_start_at: range.start_at,
                range_end_at: range.end_at,
                max_total: buckets.reduce((max, bucket) => Math.max(max, Number(bucket.total || 0)), 1),
                hottest_hour_label: hottestBucket?.label || null,
                hottest_hour_total: Number(hottestBucket?.total || 0),
                ...totals,
                buckets
            },
            hotspots: {
                targets: buildHotspots('target_key'),
                channels: buildHotspots('channel_key')
            }
        };
    },

    summarizeDeliveryMockDeadLetterTasks: function (tasks = []) {
        return tasks.reduce((summary, task) => {
            const key = String(task.dead_letter_reason || 'unknown').trim().toLowerCase() || 'unknown';
            summary.total += 1;
            summary[key] = Number(summary[key] || 0) + 1;
            return summary;
        }, {
            total: 0,
            manual: 0,
            missing_target: 0,
            timeout: 0,
            upstream_4xx: 0,
            upstream_5xx: 0,
            max_attempts: 0,
            conflict_strategy: 0,
            network_failure: 0,
            unknown: 0
        });
    },

    summarizeDeliveryMockLockTasks: function (tasks = []) {
        return tasks.reduce((summary, task) => {
            const lockState = String(task.lock_state || '').trim().toLowerCase();
            summary.total += 1;
            if (lockState === 'locked_active') summary.active += 1;
            if (lockState === 'locked_stale' || lockState === 'locked_unknown') summary.stale += 1;
            if (lockState === 'lock_missing') summary.missing += 1;
            if (task.manual_replay_requested_at) summary.manual_replay_requested += 1;
            return summary;
        }, {
            total: 0,
            active: 0,
            stale: 0,
            missing: 0,
            manual_replay_requested: 0,
            force_unlock_candidates: tasks.filter((task) => ['locked_stale', 'lock_missing', 'locked_unknown'].includes(String(task.lock_state || '').trim().toLowerCase())).length
        });
    },

    summarizeDeliveryMockReservationTasks: function (tasks = []) {
        const uniqueTargets = new Set();
        const uniqueChannels = new Set();
        let oldestActiveAt = null;
        const summary = {
            total: tasks.length,
            active: 0,
            token_drift: 0,
            worker_drift: 0,
            stale_lock: 0,
            missing_lock: 0,
            released_pending_cleanup: 0,
            incomplete: 0,
            drift_total: 0,
            distinct_targets: 0,
            distinct_channels: 0,
            oldest_active_at: null
        };

        tasks.forEach((task) => {
            const key = String(task.reservation_state?.key || '').trim().toLowerCase();
            if (task.target_key) uniqueTargets.add(task.target_key);
            if (task.channel_key) uniqueChannels.add(task.channel_key);
            if (Object.prototype.hasOwnProperty.call(summary, key)) {
                summary[key] += 1;
            }
            if (['token_drift', 'worker_drift', 'stale_lock', 'missing_lock', 'released_pending_cleanup', 'incomplete'].includes(key)) {
                summary.drift_total += 1;
            }
            if (key === 'active' && task.reservation_acquired_at) {
                const timestamp = new Date(task.reservation_acquired_at).getTime();
                if (!oldestActiveAt || timestamp < oldestActiveAt) oldestActiveAt = timestamp;
            }
        });

        summary.distinct_targets = uniqueTargets.size;
        summary.distinct_channels = uniqueChannels.size;
        summary.oldest_active_at = oldestActiveAt ? new Date(oldestActiveAt).toISOString() : null;
        return summary;
    },

    summarizeDeliveryMockReplayRecords: function (records = []) {
        const admins = new Set();
        let latestReplayAt = null;
        const summary = {
            total: records.length,
            delivered: 0,
            dead_letter: 0,
            pending: 0,
            retry_waiting: 0,
            missing_task: 0,
            admin_count: 0,
            latest_replay_at: null
        };

        records.forEach((record) => {
            if (record.admin_email || record.admin_id) admins.add(record.admin_email || record.admin_id);
            const timestamp = new Date(record.created_at || 0).getTime();
            if (Number.isFinite(timestamp) && (!latestReplayAt || timestamp > latestReplayAt)) latestReplayAt = timestamp;
            const status = String(record.task?.status || '').trim().toLowerCase();
            if (!status) {
                summary.missing_task += 1;
            } else if (Object.prototype.hasOwnProperty.call(summary, status)) {
                summary[status] += 1;
            }
        });

        summary.admin_count = admins.size;
        summary.latest_replay_at = latestReplayAt ? new Date(latestReplayAt).toISOString() : null;
        return summary;
    },

    summarizeDeliveryMockConflictAudits: function (records = []) {
        let latestConflictAt = null;
        const summary = {
            total: records.length,
            target_max_inflight: 0,
            target_min_interval: 0,
            channel_max_inflight: 0,
            channel_min_interval: 0,
            manual_force_unlock: 0,
            dead_letter: 0,
            latest_conflict_at: null
        };

        records.forEach((record) => {
            const reasonKey = String(record.reason_key || '').trim().toLowerCase();
            if (Object.prototype.hasOwnProperty.call(summary, reasonKey)) {
                summary[reasonKey] += 1;
            }
            if (String(record.task_status || '').trim().toLowerCase() === 'dead_letter') {
                summary.dead_letter += 1;
            }
            const timestamp = new Date(record.created_at || 0).getTime();
            if (Number.isFinite(timestamp) && (!latestConflictAt || timestamp > latestConflictAt)) {
                latestConflictAt = timestamp;
            }
        });

        summary.latest_conflict_at = latestConflictAt ? new Date(latestConflictAt).toISOString() : null;
        return summary;
    },

    buildDeliveryMockSummary: function (tasks = [], analytics = null, reservationSummary = null) {
        const summary = tasks.reduce((acc, task) => {
            const status = String(task.status || '').trim().toLowerCase();
            acc.total += 1;
            if (Object.prototype.hasOwnProperty.call(acc, status)) {
                acc[status] += 1;
            }
            if (Number(task.conflict_count || 0) > 0) acc.conflict_tasks += 1;
            if (Number(task.manual_replay_count || 0) > 0) acc.manual_replays += 1;
            if (String(task.lock_state || '').trim().toLowerCase() === 'locked_active') acc.locked_active += 1;
            if (['locked_stale', 'locked_unknown'].includes(String(task.lock_state || '').trim().toLowerCase())) acc.locked_stale += 1;
            if (String(task.lock_state || '').trim().toLowerCase() === 'lock_missing') acc.lock_missing += 1;
            return acc;
        }, {
            total: 0,
            pending: 0,
            processing: 0,
            retry_waiting: 0,
            requeued: 0,
            dead_letter: 0,
            delivered: 0,
            conflict_tasks: 0,
            manual_replays: 0,
            locked_active: 0,
            locked_stale: 0,
            lock_missing: 0,
            retryable: 0,
            force_unlock_candidates: 0,
            reservation_active: 0,
            reservation_drift: 0,
            reservation_targets: 0,
            reservation_channels: 0,
            recent_conflicts: 0,
            recent_conflicts_label: `${this.getDeliveryAnalyticsWindowConfig().label} 冲突`
        });

        summary.retryable = summary.pending + summary.processing + summary.retry_waiting + summary.requeued;
        summary.force_unlock_candidates = summary.locked_stale + summary.lock_missing;
        if (reservationSummary) {
            summary.reservation_active = Number(reservationSummary.active || 0);
            summary.reservation_drift = Number(reservationSummary.drift_total || 0);
            summary.reservation_targets = Number(reservationSummary.distinct_targets || 0);
            summary.reservation_channels = Number(reservationSummary.distinct_channels || 0);
        }
        if (analytics?.summary) {
            summary.recent_conflicts = Number(analytics.summary.total_conflicts || 0);
            summary.recent_conflicts_label = `${analytics.summary.window_label || this.getDeliveryAnalyticsWindowConfig().label} 冲突`;
        }
        return summary;
    },

    buildDeliveryMockResponse: function (params = {}) {
        const store = this.ensureDeliveryMockStore();
        const tasks = this.cloneDeliveryMockValue(store.tasks || []);
        const taskMap = new Map(tasks.map((task) => [task.id, task]));
        const query = String(params.query || '').trim();
        const status = String(params.status || 'all').trim().toLowerCase() || 'all';
        const deadLetterReason = String(params.deadLetterReason || 'all').trim().toLowerCase() || 'all';
        const lockState = String(params.lockState || 'all').trim().toLowerCase() || 'all';
        const analyticsWindow = this.getDeliveryAnalyticsWindowConfig(params.analyticsWindow).key;
        const taskIdentity = params.taskIdentity || null;
        const conflictBucket = params.conflictBucket?.startAt && params.conflictBucket?.endAt ? params.conflictBucket : null;
        const sourceConflictRecords = this.cloneDeliveryMockValue(store.conflictRecords || []).map((record) => ({
            ...record,
            task: taskMap.get(record.task_id) || null,
            order: taskMap.get(record.task_id)?.order || null,
            conflict_reason: this.getDeliveryMockConflictReasonMeta(record.reason_key)
        }));

        const bucketScopedRecords = sourceConflictRecords.filter((record) => this.matchesDeliveryMockConflictBucket(record, conflictBucket));
        const bucketTaskIds = new Set(bucketScopedRecords.map((record) => String(record.task_id || '').trim()).filter(Boolean));
        const bucketOrderIds = new Set(bucketScopedRecords.map((record) => String(record.order_id || '').trim()).filter(Boolean));

        const matchesSharedTaskFilter = (task) => {
            if (!this.matchesDeliveryMockTaskQuery(task, query)) return false;
            if (!this.matchesDeliveryMockTaskIdentity(task, taskIdentity)) return false;
            if (!conflictBucket) return true;
            return bucketTaskIds.has(String(task.id || '').trim()) || bucketOrderIds.has(String(task.order_id || '').trim());
        };
        const sharedTasks = tasks.filter(matchesSharedTaskFilter)
            .sort((left, right) => new Date(right.updated_at || right.created_at || 0).getTime() - new Date(left.updated_at || left.created_at || 0).getTime());

        const mainTasks = sharedTasks.filter((task) => status === 'all' || String(task.status || '').trim().toLowerCase() === status);
        const mainPage = this.paginateDeliveryMockRows(mainTasks, params.page || 1, params.pageSize || this.deliveryTaskPageSize);

        const deadLetterTasksAll = sharedTasks.filter((task) => String(task.status || '').trim().toLowerCase() === 'dead_letter')
            .filter((task) => this.matchesDeliveryMockDeadLetterReason(task, deadLetterReason));
        const deadLetterPage = this.paginateDeliveryMockRows(deadLetterTasksAll, params.deadLetterPage || 1, params.deadLetterPageSize || this.deliveryDeadLetterPageSize);

        const lockTasksAll = sharedTasks.filter((task) => this.matchesDeliveryMockLockState(task, lockState));
        const lockPage = this.paginateDeliveryMockRows(lockTasksAll, params.lockPage || 1, params.lockPageSize || this.deliveryLockConflictPageSize);

        const reservationTasksAll = sharedTasks.filter((task) => this.hasDeliveryMockReservationSnapshot(task));
        const reservationTasks = reservationTasksAll.slice(0, 8);

        const replayRecordsAll = this.cloneDeliveryMockValue(store.replayRecords || [])
            .map((record) => ({
                ...record,
                task: taskMap.get(record.task_id) || null,
                order: taskMap.get(record.task_id)?.order || null
            }))
            .filter((record) => {
                if (!record.task) return false;
                return matchesSharedTaskFilter(record.task);
            })
            .sort((left, right) => new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime());
        const replayPage = this.paginateDeliveryMockRows(replayRecordsAll, params.replayPage || 1, params.replayPageSize || this.deliveryReplayPageSize);

        const conflictRecordsSource = sourceConflictRecords
            .filter((record) => this.matchesDeliveryMockConflictQuery(record, query))
            .filter((record) => this.matchesDeliveryMockTaskIdentity(record.task || {}, taskIdentity))
            .filter((record) => this.matchesDeliveryMockConflictBucket(record, conflictBucket))
            .sort((left, right) => new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime());
        const conflictRecords = conflictRecordsSource
            .filter((record) => this.matchesDeliveryMockConflictReason(record, params.conflictReason))
            .filter((record) => {
                const targetQuery = String(params.conflictTarget || '').trim().toLowerCase();
                return !targetQuery || String(record.target_key || '').trim().toLowerCase().includes(targetQuery);
            })
            .filter((record) => {
                const channelQuery = String(params.conflictChannel || '').trim().toLowerCase();
                return !channelQuery || String(record.channel_key || '').trim().toLowerCase().includes(channelQuery);
            });

        const analyticsRecords = sourceConflictRecords
            .filter((record) => this.matchesDeliveryMockConflictQuery(record, query))
            .filter((record) => this.matchesDeliveryMockTaskIdentity(record.task || {}, taskIdentity));
        const analytics = this.buildDeliveryMockConflictAnalytics(analyticsRecords, reservationTasksAll, analyticsWindow);
        const reservationSummary = this.summarizeDeliveryMockReservationTasks(reservationTasksAll);

        return {
            success: true,
            page: mainPage.page,
            pageSize: mainPage.pageSize,
            total: mainPage.total,
            summary: this.buildDeliveryMockSummary(tasks, analytics, reservationSummary),
            filters: {
                query,
                analyticsWindow,
                conflictBucket: conflictBucket
                    ? {
                        start_at: conflictBucket.startAt,
                        end_at: conflictBucket.endAt,
                        record_count: bucketScopedRecords.length,
                        task_count: bucketTaskIds.size,
                        order_count: bucketOrderIds.size
                    }
                    : null,
                taskIdentity: taskIdentity && (taskIdentity.taskId || taskIdentity.orderId) ? taskIdentity : null,
                conflictAudit: {
                    reason: this.normalizeDeliveryConflictAuditReasonFilter(params.conflictReason),
                    target_query: String(params.conflictTarget || '').trim(),
                    channel_query: String(params.conflictChannel || '').trim()
                }
            },
            tasks: mainPage.rows,
            deadLetter: {
                page: deadLetterPage.page,
                pageSize: deadLetterPage.pageSize,
                total: deadLetterPage.total,
                summary: this.summarizeDeliveryMockDeadLetterTasks(deadLetterTasksAll),
                reason: deadLetterReason,
                tasks: deadLetterPage.rows
            },
            lockConflicts: {
                page: lockPage.page,
                pageSize: lockPage.pageSize,
                total: lockPage.total,
                summary: this.summarizeDeliveryMockLockTasks(lockTasksAll),
                lockState,
                tasks: lockPage.rows
            },
            reservations: {
                total: reservationTasksAll.length,
                summary: reservationSummary,
                tasks: reservationTasks
            },
            analytics,
            replay: {
                page: replayPage.page,
                pageSize: replayPage.pageSize,
                total: replayPage.total,
                summary: this.summarizeDeliveryMockReplayRecords(replayRecordsAll),
                records: replayPage.rows
            },
            conflicts: {
                total: conflictRecords.length,
                sourceTotal: conflictRecordsSource.length,
                filters: {
                    reason: this.normalizeDeliveryConflictAuditReasonFilter(params.conflictReason),
                    target_query: String(params.conflictTarget || '').trim(),
                    channel_query: String(params.conflictChannel || '').trim()
                },
                summary: this.summarizeDeliveryMockConflictAudits(conflictRecords),
                records: conflictRecords
            }
        };
    },

    performDeliveryMockTaskAction: async function (taskId, action, note = '') {
        const store = this.ensureDeliveryMockStore();
        const task = (store.tasks || []).find((item) => String(item.id || '').trim() === String(taskId || '').trim());
        if (!task) {
            throw new Error('模拟任务不存在');
        }

        const nowIso = new Date().toISOString();
        const nextReplayId = `mock-replay-${String(store.nextReplayId || 1).padStart(3, '0')}`;
        const nextConflictId = `mock-conflict-${String(store.nextConflictId || 1).padStart(3, '0')}`;
        const applyTaskStatus = (nextStatus, orderStatus = nextStatus) => {
            task.status = nextStatus;
            if (task.order) task.order.delivery_status = orderStatus;
            task.updated_at = nowIso;
        };

        if (action === 'requeue') {
            applyTaskStatus('requeued');
            task.next_attempt_at = new Date(Date.now() + 3 * 60 * 1000).toISOString();
            task.last_error = note || '模拟验收：重新入队';
            task.lock_state = 'unlocked';
        } else if (action === 'replay') {
            const previousStatus = task.status;
            applyTaskStatus('requeued');
            task.manual_replay_count = Number(task.manual_replay_count || 0) + 1;
            task.manual_replay_requested_at = nowIso;
            task.manual_replay_requested_by = 'ops.mock@example.com';
            task.next_attempt_at = new Date(Date.now() + 2 * 60 * 1000).toISOString();
            task.last_error = note || '模拟验收：人工重放';
            store.replayRecords.unshift({
                id: nextReplayId,
                created_at: nowIso,
                admin_id: 'admin-mock-1',
                admin_email: 'ops.mock@example.com',
                task_id: task.id,
                order_id: task.order_id,
                previous_status: previousStatus,
                next_status: task.status,
                note: note || '模拟验收：人工重放'
            });
            store.nextReplayId = Number(store.nextReplayId || 1) + 1;
        } else if (action === 'mark_delivered') {
            applyTaskStatus('delivered');
            task.delivered_at = nowIso;
            task.next_attempt_at = null;
            task.last_error = null;
            task.lock_token = null;
            task.lock_expires_at = null;
            task.locked_at = null;
            task.lock_state = 'unlocked';
            task.reservation_acquired_at = null;
            task.reservation_lock_token = null;
            task.reservation_worker_name = null;
            task.reservation_state = { key: 'none', label: '无占位', tone: 'muted' };
        } else if (action === 'force_unlock') {
            task.lock_token = null;
            task.lock_expires_at = null;
            task.locked_at = null;
            task.lock_state = 'lock_missing';
            task.last_error = note || '模拟验收：人工强制解锁';
            task.last_conflict_at = nowIso;
            task.last_conflict_reason = 'manual_force_unlock';
            task.last_conflict_scope = 'manual';
            task.last_conflict_note = note || '模拟验收：人工强制解锁';
            task.conflict_count = Number(task.conflict_count || 0) + 1;
            task.reservation_state = { key: 'released_pending_cleanup', label: '占位残留', tone: 'warn' };
            store.conflictRecords.unshift({
                id: nextConflictId,
                task_id: task.id,
                order_id: task.order_id,
                scope: 'manual',
                reason_key: 'manual_force_unlock',
                detail: note || '模拟验收：人工强制解锁',
                strategy_snapshot: this.cloneDeliveryMockValue(store.strategy),
                target_key: task.target_key,
                channel_key: task.channel_key,
                worker_name: 'ops.mock@example.com',
                lock_token: task.reservation_lock_token || null,
                task_status: task.status,
                next_attempt_at: task.next_attempt_at,
                created_at: nowIso,
                conflict_reason: this.getDeliveryMockConflictReasonMeta('manual_force_unlock')
            });
            store.nextConflictId = Number(store.nextConflictId || 1) + 1;
        } else if (action === 'mark_dead_letter') {
            applyTaskStatus('dead_letter');
            task.dead_lettered_at = nowIso;
            task.dead_letter_reason = 'manual';
            task.next_attempt_at = null;
            task.last_error = note || '模拟验收：人工标记死信';
        } else {
            throw new Error('模拟模式暂不支持该动作');
        }

        return {
            success: true,
            message: `模拟验收：已执行 ${action}`
        };
    },

    copyTextToClipboard: async function (content) {
        const text = String(content ?? '');
        if (!text) throw new Error('EMPTY_COPY_TEXT');

        if (navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return;
        }

        const helper = document.createElement('textarea');
        helper.value = text;
        helper.setAttribute('readonly', '');
        helper.className = 'shop-admin-clipboard-helper';
        document.body.appendChild(helper);
        helper.select();
        helper.setSelectionRange(0, helper.value.length);

        let copied = false;
        try {
            copied = document.execCommand('copy');
        } finally {
            helper.remove();
        }

        if (!copied) {
            throw new Error('COPY_COMMAND_FAILED');
        }
    },

    setDeliveryRestoreLinkFeedback: function (tone = 'neutral', message = '') {
        if (this.deliveryRestoreLinkFeedbackTimer) {
            window.clearTimeout(this.deliveryRestoreLinkFeedbackTimer);
            this.deliveryRestoreLinkFeedbackTimer = null;
        }

        const normalizedMessage = String(message || '').trim();
        this.deliveryRestoreLinkFeedback = normalizedMessage
            ? {
                tone: tone || 'neutral',
                message: normalizedMessage
            }
            : null;

        const filterHint = document.getElementById('deliveryTaskFilterHint');
        if (filterHint) {
            this.renderDeliveryTaskFilterHint();
        }

        if (!this.deliveryRestoreLinkFeedback) return;
        this.deliveryRestoreLinkFeedbackTimer = window.setTimeout(() => {
            this.deliveryRestoreLinkFeedbackTimer = null;
            this.deliveryRestoreLinkFeedback = null;
            const nextFilterHint = document.getElementById('deliveryTaskFilterHint');
            if (nextFilterHint) {
                this.renderDeliveryTaskFilterHint();
            }
        }, 2600);
    },

    getDeliveryRestoreLinkFeedbackMeta: function () {
        const feedback = this.deliveryRestoreLinkFeedback || null;
        if (!feedback) {
            return {
                tone: 'neutral',
                icon: 'fa-link',
                label: '复制恢复链接',
                note: '链接会保留当前商城模块、页签、时间窗与联动筛选，适合刷新后继续排障或直接发给同事。'
            };
        }

        if (feedback.tone === 'success') {
            return {
                tone: 'success',
                icon: 'fa-check',
                label: '已复制恢复链接',
                note: feedback.message
            };
        }

        if (feedback.tone === 'danger') {
            return {
                tone: 'danger',
                icon: 'fa-triangle-exclamation',
                label: '复制失败',
                note: feedback.message
            };
        }

        return {
            tone: 'neutral',
            icon: 'fa-link',
            label: '复制恢复链接',
            note: feedback.message
        };
    },

    copyDeliveryRestoreLink: async function () {
        const restoreUrl = this.buildDeliveryRestoreUrl();
        if (!restoreUrl) {
            this.setDeliveryRestoreLinkFeedback('danger', '恢复链接生成失败，请稍后再试。');
            return;
        }

        try {
            await this.copyTextToClipboard(restoreUrl);
            this.setDeliveryRestoreLinkFeedback('success', '已复制。打开或分享这条链接后，会直接回到当前履约排障上下文。');
        } catch (error) {
            console.error('[ShopAdmin] copyDeliveryRestoreLink failed:', error);
            this.setDeliveryRestoreLinkFeedback('danger', '剪贴板写入失败，请检查浏览器权限或手动复制地址栏。');
        }
    },

    switchTab: function (tabName, options = {}) {
        const normalizedTab = this.normalizeShopTabName(tabName);
        this.currentTab = normalizedTab;
        this.ensureDeliveryWorkspaceMounted();
        this.syncShopUrlState();

        this.applyShopTabState(normalizedTab);
        const shouldLoadTab = options?.load !== false;

        if (shouldLoadTab) {
            void this.ensureShopTabReady(normalizedTab, { force: options.force === true }).catch((error) => {
                console.error(`[ShopAdmin] Failed to load ${normalizedTab} tab:`, error);
            });
        }

        if (options.prefetch !== false) {
            this.scheduleShopTabPrefetch(normalizedTab);
        }
    },

    scrollFocusedOrderIntoView: function () {
        if (!this.focusedOrderId) {
            return;
        }

        const encodedOrderId = window.CSS?.escape
            ? window.CSS.escape(this.focusedOrderId)
            : this.focusedOrderId.replace(/"/g, '\\"');
        const row = document.querySelector(`.shop-order-row[data-order-id="${encodedOrderId}"]`);
        if (row instanceof HTMLElement) {
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    },

    focusOrder: async function (orderId, options = {}) {
        const normalizedOrderId = String(orderId || '').replace(/^SHOP_ORDER_/i, '').trim();
        if (!normalizedOrderId) {
            return { opened: false, matched: false };
        }

        if (!this._initialized) {
            await this.init();
        }

        this.focusedOrderId = normalizedOrderId;
        this.pendingOpenOrderDetails = options?.openDetails !== false;
        if (Object.prototype.hasOwnProperty.call(options || {}, 'context')) {
            this.setOrderSearchContext(options.context);
        } else {
            this.renderOrderSearchContextHint();
        }

        if (this.currentTab !== 'orders') {
            this.switchTab('orders', { load: false });
        } else {
            this.applyShopTabState('orders');
        }

        const orderSearchInput = document.getElementById('orderSearchInput');
        if (orderSearchInput) {
            orderSearchInput.value = normalizedOrderId;
        }

        const result = await this.searchOrders(1, {
            queryOverride: normalizedOrderId,
            focusOrderId: normalizedOrderId,
            openDetails: this.pendingOpenOrderDetails
        });
        return result && typeof result === 'object'
            ? result
            : { opened: Boolean(result), matched: Boolean(result) };
    },

    applyShopTabState: function (tabName) {
        document.querySelectorAll('.shop-tab').forEach((el) => {
            const isActive = el.dataset.shopTab === tabName;
            el.classList.toggle('active', isActive);
            el.classList.toggle('admin-studio-inline-style-attr-44', isActive);
            el.classList.toggle('admin-studio-inline-style-attr-45', !isActive);
        });

        document.querySelectorAll('.shop-view').forEach((el) => {
            const isActive = el.id === `shop-view-${tabName}`;
            el.classList.toggle('shop-view--active', isActive);
            el.classList.toggle('admin-studio-inline-style-attr-3', !isActive);
        });
    },

    syncProductSelectionModeUi: function () {
        const toggleBtn = document.getElementById('toggleProductSelectionBtn');
        const batchBtn = document.getElementById('productBatchActionsBtn');
        const grid = document.getElementById('productsGrid');

        if (toggleBtn) {
            toggleBtn.classList.toggle('active', this.isProductSelectionMode);
        }
        if (batchBtn) {
            batchBtn.classList.toggle('admin-studio-inline-style-attr-3', !this.isProductSelectionMode);
        }
        if (grid) {
            grid.classList.toggle('shop-admin-products-grid--selection-mode', this.isProductSelectionMode);
        }

        if (!this.isProductSelectionMode) {
            document.querySelectorAll('.product-select-checkbox').forEach((input) => {
                input.checked = false;
            });
            this.closeProductBatchMenu();
            this.updateProductSelectionCount();
        }
    },

    renderProductGridSkeleton: function (container, { count = 4 } = {}) {
        if (!(container instanceof HTMLElement)) {
            return;
        }

        const skeletonCount = Math.max(2, Number.parseInt(count, 10) || 4);
        const skeletonCards = Array.from({ length: skeletonCount }, (_, index) => `
            <div class="shop-admin-product-card shop-admin-product-card--skeleton" aria-hidden="true" data-skeleton-index="${index}">
                <div class="shop-admin-product-cover shop-admin-product-cover--skeleton">
                    <div class="shop-admin-skeleton shop-admin-skeleton--badge"></div>
                </div>
                <div class="shop-admin-product-body">
                    <div class="shop-admin-skeleton shop-admin-skeleton--title"></div>
                    <div class="shop-admin-skeleton shop-admin-skeleton--text"></div>
                    <div class="shop-admin-skeleton shop-admin-skeleton--text shop-admin-skeleton--text-short"></div>
                </div>
                <div class="shop-admin-product-footer">
                    <div class="shop-admin-product-meta">
                        <div class="shop-admin-skeleton shop-admin-skeleton--price"></div>
                        <div class="shop-admin-skeleton shop-admin-skeleton--stock"></div>
                    </div>
                    <div class="shop-admin-product-actions">
                        <div class="shop-admin-skeleton shop-admin-skeleton--icon-btn"></div>
                        <div class="shop-admin-skeleton shop-admin-skeleton--icon-btn"></div>
                        <div class="shop-admin-skeleton shop-admin-skeleton--icon-btn"></div>
                    </div>
                </div>
            </div>
        `).join('');

        container.innerHTML = `
            <div class="shop-admin-product-card shop-admin-product-card--create shop-admin-product-card--skeleton-create" aria-hidden="true">
                <div class="shop-admin-skeleton shop-admin-skeleton--create-icon"></div>
                <div class="shop-admin-skeleton shop-admin-skeleton--create-label"></div>
            </div>
            ${skeletonCards}
        `;
    },

    buildShopTableLoadingSkeleton: function (columnCount, { rowCount = 5, includeCheckbox = false, actionCount = 2 } = {}) {
        const totalColumns = Math.max(1, Number.parseInt(columnCount, 10) || 1);
        const totalRows = Math.max(3, Number.parseInt(rowCount, 10) || 5);
        const totalActions = Math.max(1, Number.parseInt(actionCount, 10) || 2);
        const titleWidths = ['admin-skeleton-w-40', 'admin-skeleton-w-60', 'admin-skeleton-w-70'];
        const metaWidths = ['admin-skeleton-w-30', 'admin-skeleton-w-40'];
        const pillWidths = ['admin-skeleton-w-chip-sm', 'admin-skeleton-w-chip-md'];
        const lineWidths = ['admin-skeleton-w-40', 'admin-skeleton-w-60', 'admin-skeleton-w-80'];

        return Array.from({ length: totalRows }, (_, rowIndex) => `
            <tr class="admin-table-skeleton-row shop-table-skeleton-row" aria-hidden="true" data-skeleton-index="${rowIndex}">
                ${Array.from({ length: totalColumns }, (_, columnIndex) => {
                    if (includeCheckbox && columnIndex === 0) {
                        return `
                            <td>
                                <div class="admin-table-skeleton-cell">
                                    <span class="admin-skeleton-block admin-skeleton-block--checkbox"></span>
                                </div>
                            </td>
                        `;
                    }

                    const effectiveIndex = includeCheckbox ? columnIndex - 1 : columnIndex;
                    const isLastColumn = columnIndex === totalColumns - 1;

                    if (isLastColumn) {
                        return `
                            <td>
                                <div class="admin-table-skeleton-cell admin-table-skeleton-actions">
                                    ${Array.from({ length: totalActions }, () => '<span class="admin-skeleton-block admin-skeleton-block--action"></span>').join('')}
                                </div>
                            </td>
                        `;
                    }

                    if (effectiveIndex === 0) {
                        return `
                            <td>
                                <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack">
                                    <span class="admin-skeleton-block admin-skeleton-block--title ${titleWidths[rowIndex % titleWidths.length]}"></span>
                                    <span class="admin-skeleton-block admin-skeleton-block--line ${metaWidths[rowIndex % metaWidths.length]}"></span>
                                </div>
                            </td>
                        `;
                    }

                    if (effectiveIndex === 1) {
                        return `
                            <td>
                                <div class="admin-table-skeleton-cell">
                                    <span class="admin-skeleton-block admin-skeleton-block--pill ${pillWidths[rowIndex % pillWidths.length]}"></span>
                                </div>
                            </td>
                        `;
                    }

                    return `
                        <td>
                            <div class="admin-table-skeleton-cell">
                                <span class="admin-skeleton-block admin-skeleton-block--line ${lineWidths[(rowIndex + columnIndex) % lineWidths.length]}"></span>
                            </div>
                        </td>
                    `;
                }).join('')}
            </tr>
        `).join('');
    },

    buildShopSkeletonIconActions: function (count = 1, extraClass = '') {
        const total = Math.max(1, Number.parseInt(count, 10) || 1);
        const className = [
            'admin-table-skeleton-cell',
            'admin-table-skeleton-actions',
            'shop-table-skeleton-actions-wrap',
            'shop-table-skeleton-actions-wrap--icon',
            String(extraClass || '').trim()
        ].filter(Boolean).join(' ');
        return `
            <div class="${className}">
                ${Array.from({ length: total }, () => '<span class="admin-skeleton-block admin-skeleton-block--action"></span>').join('')}
            </div>
        `;
    },

    buildShopSkeletonTextActions: function (widths = []) {
        const normalizedWidths = Array.isArray(widths) && widths.length
            ? widths
            : [88, 96];
        return `
            <div class="admin-table-skeleton-cell admin-table-skeleton-actions shop-table-skeleton-actions-wrap">
                ${normalizedWidths.map((width) => `
                    <span class="admin-skeleton-block admin-skeleton-block--pill shop-table-skeleton-action-pill ${this.getShopSkeletonWidthClass(width, 88)}"></span>
                `).join('')}
            </div>
        `;
    },

    getShopSkeletonWidthClass: function (width, fallbackWidth = 88) {
        const normalizedWidth = Math.max(1, Math.round(Number(width) || Number(fallbackWidth) || 88));
        return `shop-table-skeleton-w-${normalizedWidth}`;
    },

    buildShopOrdersLoadingSkeleton: function (rowCount = 5) {
        const totalRows = Math.max(3, Number.parseInt(rowCount, 10) || 5);
        const nameWidths = ['admin-skeleton-w-30', 'admin-skeleton-w-40', 'admin-skeleton-w-30', 'admin-skeleton-w-40'];
        const emailWidths = ['admin-skeleton-w-20', 'admin-skeleton-w-30', 'admin-skeleton-w-20', 'admin-skeleton-w-30'];
        const productWidths = ['admin-skeleton-w-60', 'admin-skeleton-w-70', 'admin-skeleton-w-50', 'admin-skeleton-w-60'];
        const statusWidths = [88, 94, 82, 92];
        const dateWidths = [132, 146, 124, 138];
        const pointsWidths = [16, 20, 16, 24];

        return Array.from({ length: totalRows }, (_, rowIndex) => `
            <tr class="admin-table-skeleton-row shop-table-skeleton-row" aria-hidden="true" data-skeleton-index="${rowIndex}">
                <td>
                    <div class="admin-table-skeleton-cell">
                        <span class="admin-skeleton-block admin-skeleton-block--avatar"></span>
                        <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack shop-table-skeleton-stack--tight">
                            <span class="admin-skeleton-block admin-skeleton-block--title ${nameWidths[rowIndex % nameWidths.length]}"></span>
                            <span class="admin-skeleton-block admin-skeleton-block--line ${emailWidths[rowIndex % emailWidths.length]}"></span>
                        </div>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell">
                        <span class="admin-skeleton-block admin-skeleton-block--line ${this.getShopSkeletonWidthClass(dateWidths[rowIndex % dateWidths.length], 132)}"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell">
                        <span class="admin-skeleton-block admin-skeleton-block--line ${productWidths[rowIndex % productWidths.length]}"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell">
                        <span class="admin-skeleton-block admin-skeleton-block--line ${this.getShopSkeletonWidthClass(pointsWidths[rowIndex % pointsWidths.length], 16)}"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell">
                        <span class="admin-skeleton-block admin-skeleton-block--pill shop-table-skeleton-status-pill ${this.getShopSkeletonWidthClass(statusWidths[rowIndex % statusWidths.length], 82)}"></span>
                    </div>
                </td>
                <td>
                    ${this.buildShopSkeletonIconActions(1, 'shop-table-skeleton-actions-wrap--orders')}
                </td>
            </tr>
        `).join('');
    },

    buildDeliveryTasksLoadingSkeleton: function (rowCount = 4) {
        const totalRows = Math.max(3, Number.parseInt(rowCount, 10) || 4);
        const orderWidths = ['admin-skeleton-w-30', 'admin-skeleton-w-40', 'admin-skeleton-w-30', 'admin-skeleton-w-40'];
        const noteWidths = ['admin-skeleton-w-30', 'admin-skeleton-w-40', 'admin-skeleton-w-20', 'admin-skeleton-w-30'];
        const targetWidths = ['admin-skeleton-w-60', 'admin-skeleton-w-70', 'admin-skeleton-w-50', 'admin-skeleton-w-60'];
        const errorWidths = ['admin-skeleton-w-60', 'admin-skeleton-w-70', 'admin-skeleton-w-50', 'admin-skeleton-w-60'];
        const actionWidths = [
            [76, 88, 92],
            [84, 92, 102],
            [72, 86, 94],
            [80, 90, 98]
        ];

        return Array.from({ length: totalRows }, (_, rowIndex) => `
            <tr class="admin-table-skeleton-row shop-table-skeleton-row" aria-hidden="true" data-skeleton-index="${rowIndex}">
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack shop-table-skeleton-stack--tight">
                        <span class="admin-skeleton-block admin-skeleton-block--title ${orderWidths[rowIndex % orderWidths.length]}"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line ${noteWidths[rowIndex % noteWidths.length]}"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack shop-table-skeleton-stack--tight">
                        <span class="admin-skeleton-block admin-skeleton-block--title admin-skeleton-w-50"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-30"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack shop-table-skeleton-stack--tight">
                        <div class="shop-table-skeleton-pill-row">
                            <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-xs"></span>
                            <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-sm"></span>
                        </div>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-50"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack shop-table-skeleton-stack--tight">
                        <span class="admin-skeleton-block admin-skeleton-block--line ${this.getShopSkeletonWidthClass(52 + (rowIndex % 2) * 8, 52)}"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-30"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-40"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell">
                        <span class="admin-skeleton-block admin-skeleton-block--line ${targetWidths[rowIndex % targetWidths.length]}"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack shop-table-skeleton-stack--tight">
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-40"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-30"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack shop-table-skeleton-stack--tight">
                        <span class="admin-skeleton-block admin-skeleton-block--line ${errorWidths[rowIndex % errorWidths.length]}"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-40"></span>
                    </div>
                </td>
                <td>
                    ${this.buildShopSkeletonTextActions(actionWidths[rowIndex % actionWidths.length])}
                </td>
            </tr>
        `).join('');
    },

    buildDeliveryDeadLetterLoadingSkeleton: function (rowCount = 3) {
        const totalRows = Math.max(3, Number.parseInt(rowCount, 10) || 3);
        const actionWidths = [
            [104, 84, 92],
            [112, 78, 96],
            [108, 82, 88]
        ];

        return Array.from({ length: totalRows }, (_, rowIndex) => `
            <tr class="admin-table-skeleton-row shop-table-skeleton-row" aria-hidden="true" data-skeleton-index="${rowIndex}">
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack shop-table-skeleton-stack--tight">
                        <span class="admin-skeleton-block admin-skeleton-block--title admin-skeleton-w-30"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-40"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack shop-table-skeleton-stack--tight">
                        <span class="admin-skeleton-block admin-skeleton-block--title admin-skeleton-w-50"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-30"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack shop-table-skeleton-stack--tight">
                        <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-sm"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-60"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-50"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack shop-table-skeleton-stack--tight">
                        <div class="shop-table-skeleton-pill-row">
                            <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-xs"></span>
                            <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-sm"></span>
                        </div>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-40"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack shop-table-skeleton-stack--tight">
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-30"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-40"></span>
                    </div>
                </td>
                <td>
                    ${this.buildShopSkeletonTextActions(actionWidths[rowIndex % actionWidths.length])}
                </td>
            </tr>
        `).join('');
    },

    buildDeliveryLockConflictLoadingSkeleton: function (rowCount = 3) {
        const totalRows = Math.max(3, Number.parseInt(rowCount, 10) || 3);
        const actionWidths = [
            [104, 78, 88, 98],
            [110, 84, 96, 86],
            [108, 80, 92, 102]
        ];

        return Array.from({ length: totalRows }, (_, rowIndex) => `
            <tr class="admin-table-skeleton-row shop-table-skeleton-row" aria-hidden="true" data-skeleton-index="${rowIndex}">
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack shop-table-skeleton-stack--tight">
                        <span class="admin-skeleton-block admin-skeleton-block--title admin-skeleton-w-30"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-40"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack shop-table-skeleton-stack--tight">
                        <span class="admin-skeleton-block admin-skeleton-block--title admin-skeleton-w-50"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-30"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack shop-table-skeleton-stack--tight">
                        <div class="shop-table-skeleton-pill-row">
                            <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-xs"></span>
                            <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-sm"></span>
                        </div>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-50"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell">
                        <div class="shop-table-skeleton-pill-row">
                            <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-xs"></span>
                            <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-sm"></span>
                        </div>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack shop-table-skeleton-stack--tight">
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-60"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-30"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-40"></span>
                    </div>
                </td>
                <td>
                    ${this.buildShopSkeletonTextActions(actionWidths[rowIndex % actionWidths.length])}
                </td>
            </tr>
        `).join('');
    },

    buildDeliveryReservationLoadingSkeleton: function (rowCount = 3) {
        const totalRows = Math.max(3, Number.parseInt(rowCount, 10) || 3);
        const actionWidths = [
            [104, 80, 92, 100],
            [110, 86, 96, 88],
            [108, 82, 94, 102]
        ];

        return Array.from({ length: totalRows }, (_, rowIndex) => `
            <tr class="admin-table-skeleton-row shop-table-skeleton-row" aria-hidden="true" data-skeleton-index="${rowIndex}">
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack shop-table-skeleton-stack--tight">
                        <div class="shop-table-skeleton-pill-row">
                            <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-sm"></span>
                            <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-xs"></span>
                        </div>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-50"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack shop-table-skeleton-stack--tight">
                        <span class="admin-skeleton-block admin-skeleton-block--title admin-skeleton-w-30"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-20"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack shop-table-skeleton-stack--tight">
                        <span class="admin-skeleton-block admin-skeleton-block--title admin-skeleton-w-50"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-30"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack shop-table-skeleton-stack--tight">
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-60"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-40"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack shop-table-skeleton-stack--tight">
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-70"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-60"></span>
                        <div class="shop-table-skeleton-pill-row">
                            <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-xs"></span>
                            <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-sm"></span>
                        </div>
                    </div>
                </td>
                <td>
                    ${this.buildShopSkeletonTextActions(actionWidths[rowIndex % actionWidths.length])}
                </td>
            </tr>
        `).join('');
    },

    buildDeliveryReplayLoadingSkeleton: function (rowCount = 3) {
        const totalRows = Math.max(3, Number.parseInt(rowCount, 10) || 3);

        return Array.from({ length: totalRows }, (_, rowIndex) => `
            <tr class="admin-table-skeleton-row shop-table-skeleton-row" aria-hidden="true" data-skeleton-index="${rowIndex}">
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack shop-table-skeleton-stack--tight">
                        <span class="admin-skeleton-block admin-skeleton-block--title admin-skeleton-w-30"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-20"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell">
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-40"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack shop-table-skeleton-stack--tight">
                        <span class="admin-skeleton-block admin-skeleton-block--title admin-skeleton-w-50"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-30"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack shop-table-skeleton-stack--tight">
                        <div class="shop-table-skeleton-pill-row">
                            <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-xs"></span>
                            <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-xs"></span>
                        </div>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-60"></span>
                        ${rowIndex % 2 === 0 ? '<span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-40"></span>' : ''}
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack shop-table-skeleton-stack--tight">
                        <span class="admin-skeleton-block admin-skeleton-block--line ${this.getShopSkeletonWidthClass(18 + (rowIndex % 3) * 8, 18)}"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-40"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack shop-table-skeleton-stack--tight">
                        <div class="shop-table-skeleton-pill-row">
                            <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-xs"></span>
                            <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-sm"></span>
                        </div>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-50"></span>
                    </div>
                </td>
            </tr>
        `).join('');
    },

    buildDeliveryConflictAuditLoadingSkeleton: function (rowCount = 3) {
        const totalRows = Math.max(3, Number.parseInt(rowCount, 10) || 3);

        return Array.from({ length: totalRows }, (_, rowIndex) => `
            <tr class="admin-table-skeleton-row shop-table-skeleton-row" aria-hidden="true" data-skeleton-index="${rowIndex}">
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack shop-table-skeleton-stack--tight">
                        <span class="admin-skeleton-block admin-skeleton-block--title admin-skeleton-w-30"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-20"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack shop-table-skeleton-stack--tight">
                        <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-sm"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-60"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack shop-table-skeleton-stack--tight">
                        <span class="admin-skeleton-block admin-skeleton-block--title admin-skeleton-w-40"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-50"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack shop-table-skeleton-stack--tight">
                        <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-md"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-sm"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack shop-table-skeleton-stack--tight">
                        <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-xs"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line ${rowIndex % 2 === 0 ? 'admin-skeleton-w-40' : 'admin-skeleton-w-50'}"></span>
                    </div>
                </td>
            </tr>
        `).join('');
    },

    buildInventoryTableLoadingSkeleton: function (rowCount = 5) {
        const totalRows = Math.max(3, Number.parseInt(rowCount, 10) || 5);
        const actionCounts = [3, 2, 3, 2, 3];
        const contentWidths = ['admin-skeleton-w-60', 'admin-skeleton-w-70', 'admin-skeleton-w-60', 'admin-skeleton-w-80'];
        const dateWidths = [118, 132, 126, 136];
        const checkboxCellClass = this.isSelectionMode
            ? 'inv-checkbox-col shop-inventory-checkbox-col'
            : 'inv-checkbox-col shop-inventory-checkbox-col shop-inventory-checkbox-col--hidden';

        return Array.from({ length: totalRows }, (_, rowIndex) => `
            <tr class="admin-table-skeleton-row shop-table-skeleton-row" aria-hidden="true" data-skeleton-index="${rowIndex}">
                <td class="${checkboxCellClass}">
                    <div class="admin-table-skeleton-cell">
                        <span class="admin-skeleton-block admin-skeleton-block--checkbox"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell">
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-50"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell">
                        <span class="admin-skeleton-block admin-skeleton-block--pill shop-table-skeleton-content-chip ${contentWidths[rowIndex % contentWidths.length]}"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell">
                        <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-xs"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell">
                        <span class="admin-skeleton-block admin-skeleton-block--line ${this.getShopSkeletonWidthClass(dateWidths[rowIndex % dateWidths.length], 118)}"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack shop-table-skeleton-stack--tight">
                        <span class="admin-skeleton-block admin-skeleton-block--line ${rowIndex % 2 === 0 ? 'admin-skeleton-w-40' : 'admin-skeleton-w-20'}"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-20"></span>
                    </div>
                </td>
                <td>
                    ${this.buildShopSkeletonIconActions(actionCounts[rowIndex % actionCounts.length])}
                </td>
            </tr>
        `).join('');
    },

    buildImportTreeLoadingSkeleton: function () {
        const pillWidths = ['admin-skeleton-w-chip-md', 'admin-skeleton-w-chip-lg', 'admin-skeleton-w-chip-lg'];
        const lineWidths = ['admin-skeleton-w-60', 'admin-skeleton-w-70', 'admin-skeleton-w-80'];
        const metaWidths = ['admin-skeleton-w-30', 'admin-skeleton-w-40'];

        return `
            <div class="shop-import-tree-state shop-import-tree-state--skeleton" aria-hidden="true">
                <div class="shop-import-tree-skeleton">
                    ${Array.from({ length: 3 }, (_, groupIndex) => `
                        <div class="shop-import-tree-skeleton-group">
                            <span class="admin-skeleton-block admin-skeleton-block--pill ${pillWidths[groupIndex % pillWidths.length]}"></span>
                            <div class="shop-import-tree-skeleton-items">
                                ${Array.from({ length: 3 }, (_, itemIndex) => `
                                    <div class="shop-import-tree-skeleton-item">
                                        <span class="admin-skeleton-block admin-skeleton-block--line ${lineWidths[itemIndex % lineWidths.length]}"></span>
                                        <span class="admin-skeleton-block admin-skeleton-block--tiny ${metaWidths[itemIndex % metaWidths.length]}"></span>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    },

    buildInventoryDetailLoadingSkeleton: function () {
        return `
            <div class="shop-inventory-detail-loading shop-inventory-detail-loading--skeleton" aria-hidden="true">
                <div class="shop-inventory-detail-skeleton-section shop-inventory-detail-skeleton-section--hero">
                    <span class="admin-skeleton-block admin-skeleton-block--title admin-skeleton-w-30"></span>
                    <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-full"></span>
                    <div class="shop-inventory-detail-skeleton-actions">
                        <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-sm"></span>
                    </div>
                </div>
                <div class="shop-inventory-detail-skeleton-grid">
                    ${Array.from({ length: 4 }, (_, index) => `
                        <div class="shop-inventory-detail-skeleton-section">
                            <span class="admin-skeleton-block admin-skeleton-block--tiny ${index % 2 === 0 ? 'admin-skeleton-w-20' : 'admin-skeleton-w-30'}"></span>
                            <span class="admin-skeleton-block admin-skeleton-block--title ${index % 2 === 0 ? 'admin-skeleton-w-60' : 'admin-skeleton-w-80'}"></span>
                        </div>
                    `).join('')}
                </div>
                <div class="shop-inventory-detail-skeleton-section">
                    <span class="admin-skeleton-block admin-skeleton-block--title admin-skeleton-w-20"></span>
                    <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-full"></span>
                    <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-70"></span>
                </div>
                <div class="shop-inventory-detail-skeleton-section">
                    <span class="admin-skeleton-block admin-skeleton-block--title admin-skeleton-w-30"></span>
                    <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-80"></span>
                    <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-60"></span>
                </div>
            </div>
        `;
    },

    buildDeliveryMetaLoadingSkeleton: function ({ rich = false } = {}) {
        if (rich) {
            return `
                <div class="shop-delivery-meta-skeleton" aria-hidden="true">
                    <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-md"></span>
                    <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-sm"></span>
                    <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-xs"></span>
                </div>
            `;
        }

        return '<span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-lg" aria-hidden="true"></span>';
    },

    buildDeliveryTrendLoadingSkeleton: function () {
        return `
            <div class="shop-delivery-empty shop-delivery-empty--skeleton" aria-hidden="true">
                <span class="admin-skeleton-block admin-skeleton-block--title admin-skeleton-w-40"></span>
                <div class="shop-delivery-chart-skeleton">
                    <span class="admin-skeleton-block shop-delivery-chart-skeleton-bar shop-delivery-chart-skeleton-bar--sm"></span>
                    <span class="admin-skeleton-block shop-delivery-chart-skeleton-bar shop-delivery-chart-skeleton-bar--lg"></span>
                    <span class="admin-skeleton-block shop-delivery-chart-skeleton-bar shop-delivery-chart-skeleton-bar--md"></span>
                    <span class="admin-skeleton-block shop-delivery-chart-skeleton-bar shop-delivery-chart-skeleton-bar--xl"></span>
                    <span class="admin-skeleton-block shop-delivery-chart-skeleton-bar shop-delivery-chart-skeleton-bar--sm-mid"></span>
                    <span class="admin-skeleton-block shop-delivery-chart-skeleton-bar shop-delivery-chart-skeleton-bar--lg-mid"></span>
                </div>
            </div>
        `;
    },

    buildDeliveryHotspotLoadingSkeleton: function () {
        return `
            <div class="shop-delivery-table-note shop-delivery-table-note--skeleton" aria-hidden="true">
                <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-full"></span>
                <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-80"></span>
                <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-70"></span>
                <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-60"></span>
            </div>
        `;
    },

    // ==================== Products (Grid View) ====================
    loadProducts: async function () {
        const container = document.getElementById('productsGrid');
        if (!container) return; // Grid container might be missing if HTML update failed

        const productSearchInput = document.getElementById('productSearchInput');
        if (productSearchInput && productSearchInput.value !== this.productSearchQuery) {
            productSearchInput.value = this.productSearchQuery;
        }

        const deliveryFilterSelect = document.getElementById('productDeliveryFilter');
        if (deliveryFilterSelect) {
            deliveryFilterSelect.value = this.currentProductDeliveryFilter || 'all';
        }

        const loadGeneration = Number(this.shopTabLoadGeneration.products || 0);
        this.shopTabLoadState.products = 'loading';
        container.classList.add('shop-grid', 'shop-admin-products-grid');
        this.renderProductGridSkeleton(container);
        this.productGridCache = new Map();

        try {
            const payload = await this.loadShopProductsViaAdminApi({
                status: this.currentStatusFilter === 'active' ? 'active' : 'deleted',
                category: this.currentCategory !== 'all' ? this.currentCategory : null,
                query: this.productSearchQuery || null,
                deliveryType: this.currentProductDeliveryFilter !== 'all' ? this.currentProductDeliveryFilter : null,
                fields: 'full',
                order: 'display_order_desc'
            });
            const data = Array.isArray(payload?.rows) ? payload.rows : [];
            this.productGridCache = new Map((data || []).map((product) => [String(product.id || ''), { ...product }]));

            container.innerHTML = '';

            // Add "New Product" Card
            const addCard = document.createElement('div');
            addCard.className = 'shop-card shop-admin-product-card shop-admin-product-card--create';
            addCard.dataset.shopAction = 'product-open-create-modal';
            addCard.innerHTML = `
                <div class="shop-admin-product-create-icon" aria-hidden="true">+</div>
                <div class="shop-admin-product-create-label">新建商品</div>
            `;
            container.appendChild(addCard);

            if (!data || data.length === 0) {
                this.syncProductSelectionModeUi();
                if (Number(this.shopTabLoadGeneration.products || 0) === loadGeneration) {
                    this.shopTabLoadState.products = 'loaded';
                }
                return;
            }

            data.forEach(p => {
                const statusBadge = p.is_active
                    ? '<span class="shop-admin-status-badge shop-admin-status-badge--active">上架中</span>'
                    : '<span class="shop-admin-status-badge shop-admin-status-badge--inactive">已下架</span>';

                const stock = p.stock_count || 0;
                const stockClassName = stock < 5 ? 'shop-admin-product-stock shop-admin-product-stock--low' : 'shop-admin-product-stock shop-admin-product-stock--healthy';
                const safeProductId = this.escapeForAttr(String(p.id || ''));
                const safeProductName = this.escapeHtml(p.name || '未命名商品');
                const safeProductDescription = this.escapeHtml(p.description || '暂无描述');
                const safeProductIconUrl = this.escapeForAttr(String(p.icon_url || ''));
                const safeProductIconClass = this.escapeForAttr(String(p.icon_url || 'fas fa-box'));
                const safeProductNameAttr = this.escapeForAttr(p.name || '');
                const productAltText = this.escapeForAttr(p.name || '商品封面');
                const priceHtml = (() => {
                    const editSite = ShopAdmin.getEditSite();
                    if (editSite === 'intl') {
                        const intlPrice = p.price_points_intl;
                        return intlPrice != null
                            ? `<div class="shop-admin-product-price shop-admin-product-price--intl">${intlPrice} <span>Points</span></div>`
                            : '<div class="shop-admin-product-price shop-admin-product-price--unset">未设置国际价格</div>';
                    }
                    return `<div class="shop-admin-product-price shop-admin-product-price--cn">${p.price_points} <span>积分</span></div>`;
                })();

                const card = document.createElement('div');
                card.className = 'shop-card shop-admin-product-card' + (p.is_active ? '' : ' inactive-product');

                // If it's an image, make it cover. If icon, keep it centered.
                const displayHtml = p.icon_url?.startsWith('http')
                    ? `<img src="${safeProductIconUrl}" class="shop-admin-product-cover-image" alt="${productAltText}">`
                    : p.icon_url?.startsWith('fa')
                        ? `<i class="${safeProductIconClass} shop-admin-product-cover-icon" aria-hidden="true"></i>`
                        : (p.icon_url
                            ? `<img src="${safeProductIconUrl}" class="shop-admin-product-cover-icon-image" alt="${productAltText}">`
                            : '<i class="fas fa-box shop-admin-product-cover-icon shop-admin-product-cover-icon--fallback" aria-hidden="true"></i>');

                card.innerHTML = `
                    <div class="shop-admin-product-cover">
                        ${displayHtml}
                        <div class="product-checkbox-wrapper">
                            <input type="checkbox" class="inv-checkbox product-select-checkbox" data-product-id="${safeProductId}" 
                                data-shop-change="product-selection-count">
                        </div>
                        <div class="shop-admin-product-status-slot">${statusBadge}</div>
                    </div>
                    
                    <div class="shop-admin-product-body">
                        <h3 class="shop-admin-product-title">${safeProductName}</h3>
                        <p class="shop-admin-product-description">${safeProductDescription}</p>
                    </div>
                    
                    <div class="shop-admin-product-footer">
                        <div class="shop-admin-product-meta">
                            ${priceHtml}
                            <div class="${stockClassName}">库存: ${stock}</div>
                        </div>
                        
                        <div class="shop-admin-product-actions">
                           <button type="button" class="shop-admin-product-action-btn" data-shop-action="product-edit" data-product-id="${safeProductId}" title="编辑">
                                <i class="fas fa-edit shop-admin-product-action-icon" aria-hidden="true"></i>
                           </button>
                           <button type="button" class="shop-admin-product-action-btn" data-shop-action="product-toggle-status" data-product-id="${safeProductId}" data-new-status="${!p.is_active}" title="${p.is_active ? '下架' : '上架'}">
                                <i class="fas fa-${p.is_active ? 'eye-slash' : 'eye'} shop-admin-product-action-icon" aria-hidden="true"></i>
                           </button>
                           <button type="button" class="shop-admin-product-action-btn shop-admin-product-action-btn--danger" data-shop-action="product-delete" data-product-id="${safeProductId}" data-product-name="${safeProductNameAttr}" title="删除">
                                <i class="fas fa-trash shop-admin-product-action-icon" aria-hidden="true"></i>
                           </button>
                        </div>
                    </div>
`;

                const editBtn = card.querySelector('[data-shop-action="product-edit"]');
                if (editBtn) {
                    editBtn.addEventListener('click', async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        await this.editProduct(safeProductId);
                    });
                }

                const toggleBtn = card.querySelector('[data-shop-action="product-toggle-status"]');
                if (toggleBtn) {
                    toggleBtn.addEventListener('click', async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        await this.toggleStatus(safeProductId, !p.is_active);
                    });
                }

                const deleteBtn = card.querySelector('[data-shop-action="product-delete"]');
                if (deleteBtn) {
                    deleteBtn.addEventListener('click', async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        await this.deleteProduct(safeProductId, p.name || '');
                    });
                }

                const checkbox = card.querySelector('.product-select-checkbox');
                if (checkbox) {
                    checkbox.addEventListener('click', (e) => e.stopPropagation());
                    checkbox.addEventListener('change', () => this.updateProductSelectionCount());
                }

                // Card Click Selection
                card.addEventListener('click', (e) => {
                    if (this.isProductSelectionMode) {
                        // Avoid triggering if clicking on buttons (though stopPropagation above helps)
                        if (e.target.closest('.shop-admin-product-action-btn') || e.target.closest('.product-select-checkbox')) return;

                        const cardCheckbox = card.querySelector('.product-select-checkbox');
                        if (cardCheckbox) {
                            cardCheckbox.checked = !cardCheckbox.checked;
                            this.updateProductSelectionCount();
                        }
                    }
                });

                container.appendChild(card);
            });

            this.syncProductSelectionModeUi();

            // Refresh sidebar list
            this.loadInventoryProductList(data);
            if (Number(this.shopTabLoadGeneration.products || 0) === loadGeneration) {
                this.shopTabLoadState.products = 'loaded';
            }

        } catch (err) {
            console.error(err);
            if (Number(this.shopTabLoadGeneration.products || 0) === loadGeneration) {
                this.shopTabLoadState.products = 'error';
            }
            container.innerHTML = `<div class="shop-admin-grid-error">Error: ${this.escapeHtml(err.message || 'Unknown error')}</div>`;
        }
    },

    // ==================== Product Selection Mode ====================
    toggleProductSelectionMode: function () {
        this.isProductSelectionMode = !this.isProductSelectionMode;
        this.syncProductSelectionModeUi();
    },

    /* Dynamic Batch Menu Handling */
    _batchMenuCloseHandler: null,

    closeProductBatchMenu: function () {
        const menu = document.getElementById('productBatchActionMenu');
        if (menu) menu.classList.remove('is-open');
        if (this._batchMenuCloseHandler) {
            document.removeEventListener('click', this._batchMenuCloseHandler);
            this._batchMenuCloseHandler = null;
        }
    },

    toggleProductBatchMenu: function () {
        const menu = document.getElementById('productBatchActionMenu');
        const btn = document.getElementById('productBatchActionsBtn');
        if (!menu) return;

        const isVisible = menu.classList.contains('is-open');

        if (isVisible) {
            this.closeProductBatchMenu();
        } else {
            menu.classList.add('is-open');
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
        if (menu) {
            menu.classList.add('is-open');
        }
    },

    batchDeleteProducts: async function () {
        if (!this.requireWritableSite({ label: '批量删除商品' })) {
            return;
        }

        const selectedIds = Array.from(document.querySelectorAll('.product-select-checkbox:checked'))
            .map(cb => cb.dataset.productId);

        if (selectedIds.length === 0) {
            alert('请先选择要删除的商品');
            return;
        }

        if (!confirm(`确定删除这 ${selectedIds.length} 个商品吗？商品将被下架但保留历史订单记录。`)) return;

        try {
            const result = await this.callAdminMutation('batch_soft_delete_products', {
                productIds: selectedIds
            });

            // Exit selection mode and refresh
            this.isProductSelectionMode = true; // Will be toggled off by next line
            this.toggleProductSelectionMode(); // Exit mode
            await this.loadProducts();

            alert(`成功删除 ${result.deleted || selectedIds.length} 个商品`);
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

                const payload = await this.loadShopProductsViaAdminApi({
                    ids: selectedIds.join(','),
                    fields: 'full',
                    order: 'display_order_desc'
                });
                products = Array.isArray(payload?.rows) ? payload.rows : [];
            } else {
                const payload = await this.loadShopProductsViaAdminApi({
                    status: 'all',
                    fields: 'full',
                    order: 'display_order_desc'
                });
                products = Array.isArray(payload?.rows) ? payload.rows : [];
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
            this.closeProductBatchMenu();
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
            iconBox.innerHTML = `<img src="${iconInput}" class="shop-admin-preview-icon-image" alt="商品封面预览">`;
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
        iconBox.classList.add('upload-box--busy');

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
                window.getZaoyoeSupabaseFunctionUrl('upload-avatar'),
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
                iconBox.classList.remove('upload-box--busy');
            }, 2000);

            console.log('✅ Product image uploaded to R2:', imageUrl);

        } catch (err) {
            console.error('Upload failed:', err);
            alert('上传失败: ' + err.message);
            uploadText.textContent = '❌ 上传失败';
            iconBox.classList.remove('upload-box--busy');
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
                return `<div class="custom-category-option" data-shop-action="product-select-category" data-category-name="${this.escapeForAttr(cat.name)}" data-category-color="${this.escapeForAttr(color)}">
                    <span class="option-dot ${this.buildCategoryColorClass(color)}"></span>
                    <span>${cat.name}</span>
                </div>`;
            }).join('');

            // If no categories, add default
            if (categories.length === 0) {
                optionsHtml = `<div class="custom-category-option" data-shop-action="product-select-category" data-category-name="other" data-category-color="#9aa0a6">
                    <span class="option-dot ${this.buildCategoryColorClass('#9aa0a6')}"></span>
                    <span>其他</span>
                </div>`;
            }

            // Add "Create new category" option at the bottom
            optionsHtml += `<div class="custom-category-option add-new-category custom-category-option--create" data-shop-action="product-show-add-category-input">
                <i class="fas fa-plus custom-category-option__create-icon"></i>
                <span>添加新分类</span>
            </div>`;

            // Add input container (hidden by default)
            optionsHtml += `<div id="newCategoryInputContainer" class="custom-category-create-panel admin-studio-inline-style-attr-3">
                <input type="text" id="newCategoryName" placeholder="输入分类名称" 
                    class="custom-category-create-panel__input"
                    data-shop-keydown="product-save-new-category">
                <div class="custom-category-create-panel__actions">
                    <button type="button" data-shop-action="product-cancel-add-category" class="custom-category-create-panel__btn custom-category-create-panel__btn--cancel">取消</button>
                    <button type="button" data-shop-action="product-save-new-category" class="custom-category-create-panel__btn custom-category-create-panel__btn--confirm">确定</button>
                </div>
            </div>`;

            optionsContainer.innerHTML = optionsHtml;
        } catch (e) {
            console.error('Failed to populate category dropdown:', e);
        }
    },

    applyProductModalCategorySelection: async function (categoryName = 'other') {
        try {
            await (this.productCategoryDropdownPromise || Promise.resolve());
        } catch (error) {
            console.warn('[ShopAdmin] Failed while waiting for category dropdown readiness:', error);
        }

        const normalizedCategoryName = String(categoryName || 'other').trim() || 'other';
        const categoryData = this.categoryData.find((cat) => cat.name === normalizedCategoryName);
        const categoryColor = categoryData?.color || '#6b9ece';
        this.selectCategory(normalizedCategoryName, categoryColor);
    },

    fillProductModalFromData: function (data) {
        if (!data) {
            return;
        }

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
        document.getElementById('prodMaxPurchaseQuantity').value = data.max_purchase_quantity != null
            ? data.max_purchase_quantity
            : '';
        this.setOptionalInputValue(
            'prodPurchaseLimit24hQuantity',
            data.purchase_limit_24h_quantity != null ? data.purchase_limit_24h_quantity : ''
        );
        this.setOptionalInputValue(
            'prodPurchaseLimitWindowQuantity',
            data.purchase_limit_window_quantity != null ? data.purchase_limit_window_quantity : ''
        );
        this.setOptionalInputValue(
            'prodPurchaseLimitWindowMinutes',
            data.purchase_limit_window_minutes != null ? data.purchase_limit_window_minutes : ''
        );
        this.setOptionalInputValue(
            'prodPerAccountPurchaseLimit',
            data.per_account_purchase_limit != null ? data.per_account_purchase_limit : ''
        );

        let parsedRules = [];
        if (data.quantity_rules && Array.isArray(data.quantity_rules)) {
            parsedRules = data.quantity_rules;
        } else if (typeof data.quantity_rules === 'string' && data.quantity_rules.trim() !== '') {
            try {
                parsedRules = JSON.parse(data.quantity_rules);
            } catch (error) {
                console.error('Failed to parse quantity rules:', error);
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

        document.getElementById('prodDeliveryType').value = normalizedDeliveryType;
        const deliveryTypeName = normalizedDeliveryType === 'API' ? '外部接口履约 (API Webhook)' : '卡密池发放 (KEY)';
        const deliveryTypeLabel = document.getElementById('prodDeliveryTypeName');
        if (deliveryTypeLabel) {
            deliveryTypeLabel.textContent = deliveryTypeName;
        }

        document.getElementById('prodWebhookTarget').value = data.webhook_target || '';
        this.toggleWebhookField(normalizedDeliveryType);

        const showPurchaseNotes = !!data.show_purchase_notes;
        document.getElementById('prodShowPurchaseNotes').checked = showPurchaseNotes;
        document.getElementById('prodPurchaseNotes').value = typeof data.purchase_notes === 'string' ? data.purchase_notes : '';
        this.togglePurchaseNotes(showPurchaseNotes);

        const showUsageInstructions = !!data.show_usage_instructions;
        document.getElementById('prodShowUsageInstructions').checked = showUsageInstructions;
        document.getElementById('prodUsageInstructions').value = typeof data.usage_instructions === 'string' ? data.usage_instructions : '';
        this.toggleUsageInstructions(showUsageInstructions);

        void this.applyProductModalCategorySelection(data.category || 'other');
        this.updatePreview();
    },

    // Show input field for adding new category
    showAddCategoryInput: function () {
        const inputContainer = document.getElementById('newCategoryInputContainer');
        const addBtn = document.querySelector('.add-new-category');
        if (inputContainer) {
            inputContainer.classList.remove('admin-studio-inline-style-attr-3');
            addBtn?.classList.add('admin-studio-inline-style-attr-3');
            document.getElementById('newCategoryName').focus();
        }
    },

    // Cancel adding new category
    cancelAddCategory: function () {
        const inputContainer = document.getElementById('newCategoryInputContainer');
        const addBtn = document.querySelector('.add-new-category');
        if (inputContainer) {
            inputContainer.classList.add('admin-studio-inline-style-attr-3');
            addBtn?.classList.remove('admin-studio-inline-style-attr-3');
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
        const newOptionHtml = `<div class="custom-category-option pending-category" data-shop-action="product-select-category" data-category-name="${this.escapeForAttr(name)}" data-category-color="${this.escapeForAttr(color)}">
            <span class="option-dot ${this.buildCategoryColorClass(color)}"></span>
            <span>${name}</span>
            <span class="custom-category-option__pending">(新)</span>
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
        this.setCategoryColorClasses(colorDot, categoryColor || '#6b9ece');

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
        wrapper.classList.toggle('shop-form-section--expanded', Boolean(show));
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

    validateProductPayloadViaAdminApi: async function ({ productId = '', payload = null, pendingCategory = null } = {}) {
        const headers = await this.getAdminAuthHeaders();
        const response = await fetch(this.buildAdminShopUrl('shop/mutate'), {
            method: 'POST',
            headers,
            body: JSON.stringify({
                action: 'validate_product',
                site: window.AdminSiteFilter?.getSiteFilter?.() || 'all',
                productId: productId || null,
                payload,
                pendingCategory
            })
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.success) {
            throw new Error(result.message || '商品配置校验失败');
        }

        return result.validation && typeof result.validation === 'object'
            ? result.validation
            : { blockingIssues: [], warnings: [] };
    },

    buildProductValidationSummary: function (validation = {}) {
        const blockingIssues = Array.isArray(validation?.blockingIssues) ? validation.blockingIssues : [];
        const warnings = Array.isArray(validation?.warnings) ? validation.warnings : [];
        const lines = [];

        if (blockingIssues.length) {
            lines.push('以下配置必须先修正：');
            blockingIssues.forEach((issue, index) => {
                lines.push(`${index + 1}. ${String(issue?.message || '').trim()}`);
            });
        }

        if (warnings.length) {
            if (lines.length) {
                lines.push('');
            }
            lines.push('以下配置建议再确认：');
            warnings.forEach((issue, index) => {
                lines.push(`${index + 1}. ${String(issue?.message || '').trim()}`);
            });
        }

        return lines.filter(Boolean).join('\n');
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
            modal.className = 'shop-delivery-switch-modal';
            document.body.appendChild(modal);
        }

        modal.innerHTML = `
            <div class="shop-delivery-switch-modal__dialog">
                <div class="shop-delivery-switch-modal__header">
                    <div class="shop-delivery-switch-modal__icon">
                        <i class="fas fa-exclamation-triangle"></i>
                    </div>
                    <h3 class="shop-delivery-switch-modal__title">切换发货模式</h3>
                </div>
                <div class="shop-delivery-switch-modal__body">
                    即将发货模式切换为 <strong class="shop-delivery-switch-modal__highlight">${this.escapeHtml(typeName)}</strong>。<br><br>
                    <span class="shop-delivery-switch-modal__warning">${warningText}</span>
                </div>
                <div class="shop-delivery-switch-modal__actions">
                    <button id="cancelDeliveryChange" type="button" class="shop-delivery-switch-modal__btn shop-delivery-switch-modal__btn--cancel">取消</button>
                    <button id="confirmDeliveryChange" type="button" class="shop-delivery-switch-modal__btn shop-delivery-switch-modal__btn--confirm">确定切换</button>
                </div>
            </div>
        `;

        modal.classList.add('is-open');
        const closeModal = () => modal.classList.remove('is-open');

        document.getElementById('cancelDeliveryChange').onclick = function () {
            closeModal();
        };

        document.getElementById('confirmDeliveryChange').onclick = () => {
            // Apply the change
            input.value = newType;
            const nameLabel = document.getElementById('prodDeliveryTypeName');
            if (nameLabel) nameLabel.textContent = typeName;
            this.toggleWebhookField(newType);
            closeModal();
        };
    },

    // Toggle Webhook field visibility
    toggleWebhookField: function (deliveryType) {
        const group = document.getElementById('webhookTargetGroup');
        if (group) {
            group.classList.toggle('admin-studio-inline-style-attr-3', deliveryType !== 'API');
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
        this.bindProductModalOverlayDismiss();
        this.productCategoryDropdownPromise = this.populateCategoryDropdown().finally(() => {
            this.productCategoryDropdownPromise = null;
        });

        const title = document.getElementById('productModalTitle');
        const siteEmoji = this.getEditSite() === 'intl' ? ' 🌍' : ' 🇨🇳';
        title.textContent = (isEdit ? '编辑商品' : '新建商品') + siteEmoji;
        modal.classList.add('active'); // In case CSS uses .active for transition

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
            await this.productCategoryDropdownPromise;
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
            document.getElementById('prodMaxPurchaseQuantity').value = '';
            this.setOptionalInputValue('prodPurchaseLimit24hQuantity', '');
            this.setOptionalInputValue('prodPurchaseLimitWindowQuantity', '');
            this.setOptionalInputValue('prodPurchaseLimitWindowMinutes', '');
            this.setOptionalInputValue('prodPerAccountPurchaseLimit', '');

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
        const requestId = `${String(id || '')}:${Date.now()}`;
        this.activeProductEditRequestId = requestId;

        void this.openProductModal(true);

        const cachedProduct = this.productGridCache instanceof Map
            ? this.productGridCache.get(String(id || ''))
            : null;
        if (cachedProduct) {
            this.fillProductModalFromData(cachedProduct);
        }

        try {
            const payload = await this.loadShopProductByIdViaAdminApi(id);
            const data = payload?.product || null;
            if (!data || this.activeProductEditRequestId !== requestId) {
                return;
            }

            if (this.productGridCache instanceof Map) {
                this.productGridCache.set(String(data.id || ''), { ...data });
            }
            this.fillProductModalFromData(data);
        } catch (error) {
            console.error('[ShopAdmin] Failed to load product details for edit:', error);
            if (!cachedProduct) {
                alert('加载商品详情失败: ' + (error?.message || '未知错误'));
                this.hideProductModal();
            }
        }
    },

    saveProduct: async function () {
        console.log('[ShopAdmin] saveProduct started');
        if (!this.requireWritableSite({ label: '保存商品' })) {
            return;
        }

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
            const maxPurchaseQuantityRaw = (document.getElementById('prodMaxPurchaseQuantity').value || '').trim();
            const purchaseLimit24hQuantityRaw = (document.getElementById('prodPurchaseLimit24hQuantity')?.value || '').trim();
            const purchaseLimitWindowQuantityRaw = (document.getElementById('prodPurchaseLimitWindowQuantity')?.value || '').trim();
            const purchaseLimitWindowMinutesRaw = (document.getElementById('prodPurchaseLimitWindowMinutes')?.value || '').trim();
            const perAccountPurchaseLimitRaw = (document.getElementById('prodPerAccountPurchaseLimit')?.value || '').trim();
            let normalizedMaxPurchaseQuantity = null;
            let normalizedPurchaseLimit24hQuantity = null;
            let normalizedPurchaseLimitWindowQuantity = null;
            let normalizedPurchaseLimitWindowMinutes = null;
            let normalizedPerAccountPurchaseLimit = null;
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

            const parseOptionalPositiveInteger = (rawValue, label) => {
                if (rawValue === '') {
                    return null;
                }

                const parsedValue = Number.parseInt(rawValue, 10);
                if (!Number.isFinite(parsedValue) || parsedValue < 1) {
                    throw new Error(`${label}必须是大于 0 的整数`);
                }

                return parsedValue;
            };

            if (maxPurchaseQuantityRaw !== '') {
                const parsedMaxPurchaseQuantity = Number.parseInt(maxPurchaseQuantityRaw, 10);
                if (!Number.isFinite(parsedMaxPurchaseQuantity) || parsedMaxPurchaseQuantity < 1 || parsedMaxPurchaseQuantity > 99) {
                    alert('单次限购必须是 1 到 99 之间的整数');
                    return;
                }
                normalizedMaxPurchaseQuantity = parsedMaxPurchaseQuantity;
            }

            try {
                normalizedPurchaseLimit24hQuantity = parseOptionalPositiveInteger(purchaseLimit24hQuantityRaw, '24小时累计上限');
                normalizedPerAccountPurchaseLimit = parseOptionalPositiveInteger(perAccountPurchaseLimitRaw, '每账号仅限购数量');

                if ((purchaseLimitWindowQuantityRaw === '') !== (purchaseLimitWindowMinutesRaw === '')) {
                    throw new Error('请同时填写 N 分钟累计上限和 N 分钟');
                }

                normalizedPurchaseLimitWindowQuantity = parseOptionalPositiveInteger(purchaseLimitWindowQuantityRaw, 'N分钟累计上限');
                normalizedPurchaseLimitWindowMinutes = parseOptionalPositiveInteger(purchaseLimitWindowMinutesRaw, 'N分钟');
            } catch (validationError) {
                alert(validationError.message || '限购配置格式错误');
                return;
            }

            document.getElementById('prodMaxPurchaseQuantity').value = normalizedMaxPurchaseQuantity == null
                ? ''
                : String(normalizedMaxPurchaseQuantity);
            this.setOptionalInputValue(
                'prodPurchaseLimit24hQuantity',
                normalizedPurchaseLimit24hQuantity == null ? '' : String(normalizedPurchaseLimit24hQuantity)
            );
            this.setOptionalInputValue(
                'prodPurchaseLimitWindowQuantity',
                normalizedPurchaseLimitWindowQuantity == null ? '' : String(normalizedPurchaseLimitWindowQuantity)
            );
            this.setOptionalInputValue(
                'prodPurchaseLimitWindowMinutes',
                normalizedPurchaseLimitWindowMinutes == null ? '' : String(normalizedPurchaseLimitWindowMinutes)
            );
            this.setOptionalInputValue(
                'prodPerAccountPurchaseLimit',
                normalizedPerAccountPurchaseLimit == null ? '' : String(normalizedPerAccountPurchaseLimit)
            );

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
                max_purchase_quantity: normalizedMaxPurchaseQuantity,
                purchase_limit_24h_quantity: normalizedPurchaseLimit24hQuantity,
                purchase_limit_window_quantity: normalizedPurchaseLimitWindowQuantity,
                purchase_limit_window_minutes: normalizedPurchaseLimitWindowMinutes,
                per_account_purchase_limit: normalizedPerAccountPurchaseLimit,
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
                const validation = await this.validateProductPayloadViaAdminApi({
                    productId: id,
                    payload,
                    pendingCategory: this.pendingCategory && payload.category === this.pendingCategory.name
                        ? this.pendingCategory
                        : null
                });

                if (Array.isArray(validation?.blockingIssues) && validation.blockingIssues.length) {
                    alert(this.buildProductValidationSummary(validation));
                    return;
                }

                if (Array.isArray(validation?.warnings) && validation.warnings.length) {
                    const confirmed = window.confirm(`${this.buildProductValidationSummary(validation)}\n\n确认继续保存吗？`);
                    if (!confirmed) {
                        return;
                    }
                }

                let mutationResult;
                if (id) {
                    const upsertPayload = this.buildExistingProductUpsertPayload(id, payload);
                    mutationResult = await this.callAdminMutation('upsert_product', {
                        productId: id,
                        payload: upsertPayload,
                        pendingCategory: this.pendingCategory && payload.category === this.pendingCategory.name
                            ? this.pendingCategory
                            : null
                    });
                    if (mutationResult?.product) {
                        this.editingProductSnapshot = mutationResult.product;
                    }
                } else {
                    mutationResult = await this.callAdminMutation('upsert_product', {
                        payload,
                        pendingCategory: this.pendingCategory && payload.category === this.pendingCategory.name
                            ? this.pendingCategory
                            : null
                    });
                }

                // Clear pending category after successful save
                this.pendingCategory = null;

                this.hideProductModal();
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
        if (!this.requireWritableSite({ label: '删除商品' })) {
            return;
        }

        if (!confirm(`确定要删除商品 "${name}" 吗？\n商品将被下架但保留历史订单记录。`)) return;

        try {
            await this.callAdminMutation('soft_delete_product', { productId: id });

            alert('商品已删除');
            this.loadProducts();
        } catch (err) {
            alert('删除失败: ' + err.message);
        }
    },

    toggleStatus: async function (id, newStatus) {
        if (!this.requireWritableSite({ label: newStatus ? '上架商品' : '下架商品' })) {
            return;
        }

        if (!confirm(`确定要${newStatus ? '上架' : '下架'} 该商品吗？`)) return;
        try {
            await this.callAdminMutation('toggle_product', { productId: id, isActive: newStatus });
            this.loadProducts();
        } catch (err) {
            alert('Error: ' + err.message);
        }
    },

    // ==================== Inventory ====================
    loadInventoryProductList: async function (preloadedData = null) {
        const container = document.getElementById('inventoryProductList');
        if (!container) return;

        let data = preloadedData;
        if (!data) {
            const payload = await this.loadShopProductsViaAdminApi({
                status: 'all',
                fields: 'full',
                order: 'display_order_desc'
            });
            data = Array.isArray(payload?.rows) ? payload.rows : [];
        }

        container.innerHTML = '';
        if (data.length === 0) {
            container.innerHTML = '<div class="shop-import-product-empty">暂无商品，请先新建</div>';
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
                        nameEl.classList.add('shop-import-target-product--visible');
                    }
                }, 0);
            }

            el.innerHTML = `
                <div class="product-select-item-name">${this.escapeHtml(p.name)}</div>
                <div class="product-select-item-meta">库存: ${Number(p.stock_count || 0)}</div>
`;

            el.onclick = () => {
                this.selectedProductId = p.id;
                const nameEl = document.getElementById('targetProductName');
                if (nameEl) {
                    nameEl.textContent = p.name;
                    nameEl.classList.add('shop-import-target-product--visible');
                }
                // Reload list to update active state
                this.loadInventoryProductList(data);
            };
            container.appendChild(el);
        });
    },

    importInventory: async function (btnElement) {
        if (!this.requireWritableSite({ label: '导入库存' })) {
            return;
        }

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

        try {
            console.log(`[ShopAdmin] Importing ${lines.length} items...`);
            await this.callAdminMutation('import_inventory', {
                productId: this.selectedProductId,
                lines,
                importStatus,
                batchId
            });

            alert(`✅ 成功导入 ${lines.length} 条库存`);

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

    buildInventoryImportBatchId: function () {
        const date = new Date();
        return date.getFullYear().toString().slice(-2) +
            (date.getMonth() + 1).toString().padStart(2, '0') +
            date.getDate().toString().padStart(2, '0') +
            date.getHours().toString().padStart(2, '0') +
            date.getMinutes().toString().padStart(2, '0');
    },

    performInventoryImport: async function ({ productId, contentLines, status = 'available', batchId = '' } = {}) {
        const lines = Array.isArray(contentLines)
            ? contentLines.map((line) => String(line || '').trim()).filter(Boolean)
            : [];
        const resolvedProductId = String(productId || '').trim();
        const resolvedBatchId = String(batchId || '').trim() || this.buildInventoryImportBatchId();

        if (!resolvedProductId) {
            throw new Error('请选择商品');
        }

        if (!lines.length) {
            throw new Error('请输入有效的账号内容');
        }

        await this.callAdminMutation('import_inventory', {
            productId: resolvedProductId,
            lines,
            importStatus: String(status || 'available').trim() || 'available',
            batchId: resolvedBatchId
        });

        return {
            batchId: resolvedBatchId,
            imported: lines.length
        };
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
        row.className = 'tiered-pricing-row shop-tiered-pricing-row';
        row.innerHTML = `
            <div class="shop-tiered-pricing-row__field">
                <span class="shop-tiered-pricing-row__label">满</span>
                <input type="number" class="modern-input tp-qty shop-tiered-pricing-row__input" placeholder="10" value="${qty}">
                <span class="shop-tiered-pricing-row__label">件</span>
            </div>
            <div class="shop-tiered-pricing-row__field">
                <span class="shop-tiered-pricing-row__label">单价降至</span>
                <input type="number" class="modern-input tp-price shop-tiered-pricing-row__input" placeholder="8" value="${price}">
                <span class="shop-tiered-pricing-row__label">积分</span>
            </div>
            <button type="button" data-shop-action="product-remove-tiered-pricing-row" class="shop-tiered-pricing-row__remove" title="删除阶梯价规则">
                <i class="fas fa-trash-alt"></i>
            </button>
        `;
        container.appendChild(row);
    },

    addTieredPricingRow: function () {
        this.injectTieredPricingRow();
    },

    // ==================== Orders (Fix FK Issue) ====================
    getDeliveryToneClass: function (tone = 'neutral') {
        const tones = new Set(['success', 'processing', 'waiting', 'warn', 'danger', 'muted', 'neutral']);
        const normalizedTone = tones.has(String(tone || 'neutral')) ? String(tone || 'neutral') : 'neutral';
        return `shop-delivery-tone--${normalizedTone}`;
    },

    renderDeliveryBadge: function (label, tone = 'neutral') {
        const toneClass = this.getDeliveryToneClass(tone);
        return `<span class="status-badge shop-delivery-badge ${toneClass}">${this.escapeHtml(label)}</span>`;
    },

    renderDeliveryMetaBadge: function (label, tone = 'neutral') {
        const toneClass = this.getDeliveryToneClass(tone);
        return `<span class="shop-delivery-meta-badge ${toneClass}">${this.escapeHtml(label)}</span>`;
    },

    buildDeliveryDataAttributes: function (attributes = {}) {
        return Object.entries(attributes)
            .filter(([, value]) => value !== undefined && value !== null && value !== false && value !== '')
            .map(([key, value]) => ` data-${key}="${this.escapeForAttr(String(value))}"`)
            .join('');
    },

    renderDeliveryFilterBreadcrumb: function ({ label, tone = 'neutral', title = '', preview = '', removeAction = '', removeAttrs = {} } = {}) {
        const toneClass = this.getDeliveryToneClass(tone);
        const titleAttr = title ? ` title="${this.escapeHtml(title)}"` : '';
        const previewAttr = preview ? ` data-preview="${this.escapeHtml(preview)}"` : '';
        const actionAttrs = removeAction
            ? this.buildDeliveryDataAttributes({
                'shop-action': removeAction,
                ...removeAttrs
            })
            : '';
        return `
            <button
                type="button"
                class="shop-delivery-filter-crumb ${toneClass}"
                ${titleAttr}${previewAttr}${actionAttrs}
            >
                <span>${this.escapeHtml(label)}</span>
                <i class="fas fa-times"></i>
            </button>
        `;
    },

    renderDeliveryQuickFilterChip: function ({ label, tone = 'neutral', active = false, title = '', action = '', actionAttrs = {} } = {}) {
        const toneClass = this.getDeliveryToneClass(tone);
        const titleAttr = title ? ` title="${this.escapeHtml(title)}"` : '';
        const delegatedAttrs = action
            ? this.buildDeliveryDataAttributes({
                'shop-action': action,
                ...actionAttrs
            })
            : '';
        const activeClass = active ? ' shop-delivery-meta-chip--active' : '';
        return `<button type="button" class="shop-delivery-meta-chip shop-delivery-meta-chip--action ${toneClass}${activeClass}"${titleAttr}${delegatedAttrs}>${this.escapeHtml(label)}</button>`;
    },

    renderDeliveryTrendLegendButton: function ({ label, tone = 'neutral', active = false, title = '', action = '', actionAttrs = {} } = {}) {
        const toneClass = this.getDeliveryToneClass(tone);
        const titleAttr = title ? ` title="${this.escapeHtml(title)}"` : '';
        const delegatedAttrs = action
            ? this.buildDeliveryDataAttributes({
                'shop-action': action,
                ...actionAttrs
            })
            : '';
        const activeClass = active ? ' shop-delivery-trend-legend-item--active' : '';
        return `
            <button
                type="button"
                class="shop-delivery-trend-legend-item ${toneClass}${activeClass}"
               ${titleAttr}${delegatedAttrs}
            >
                <i class="fas fa-circle shop-delivery-trend-legend-dot ${toneClass}"></i>
                <span>${this.escapeHtml(label)}</span>
            </button>
        `;
    },

    renderConflictAuditSummaryReasonBadge: function ({ reasonKey, label, count = 0, tone = 'neutral', active = false } = {}) {
        const total = Number(count || 0);
        if (!total && !active) {
            return this.renderDeliveryMetaBadge(`${label} ${total}`, 'muted');
        }
        return this.renderDeliveryQuickFilterChip({
            label: `${label} ${total}`,
            tone,
            active,
            title: active ? '再次点击可清除此原因过滤' : `点击按${label}反筛冲突审计`,
            action: 'delivery-conflict-audit-reason-quick-filter',
            actionAttrs: {
                'delivery-reason-key': encodeURIComponent(String(reasonKey || 'all'))
            }
        });
    },

    isDeliveryConflictDeadLetterFocusActive: function () {
        return String(this.deliveryTaskStatusFilter || 'all').trim().toLowerCase() === 'dead_letter'
            && String(this.deliveryDeadLetterReasonFilter || 'all').trim().toLowerCase() === 'conflict_strategy';
    },

    isDeliveryConflictBucketActive: function (startAt, endAt, bucket = this.deliveryConflictBucketFilter) {
        return String(bucket?.startAt || '').trim() === String(startAt || '').trim()
            && String(bucket?.endAt || '').trim() === String(endAt || '').trim();
    },

    getDeliveryTaskQuerySourceMeta: function (context = this.deliveryTaskQueryContext) {
        const sourceType = String(context?.type || 'manual').trim().toLowerCase();
        if (sourceType === 'target') {
            return { label: '目标热点', tone: 'processing' };
        }
        if (sourceType === 'channel') {
            return { label: '通道热点', tone: 'danger' };
        }
        return { label: '关键字', tone: 'neutral' };
    },

    isDeliveryHotspotQueryActive: function (type = 'target', key = '') {
        const normalizedType = type === 'channel' ? 'channel' : 'target';
        const queryContext = this.deliveryTaskQueryContext || {};
        const activeQuery = String(this.deliveryTaskQuery || '').trim().toLowerCase();
        const normalizedKey = String(key || '').trim().toLowerCase();
        return Boolean(
            normalizedKey
            && String(queryContext.type || '').trim().toLowerCase() === normalizedType
            && activeQuery === normalizedKey
        );
    },

    normalizeDeliveryConflictAuditReasonFilter: function (value) {
        const allowed = new Set([
            'all',
            'target_conflicts',
            'target_max_inflight',
            'target_min_interval',
            'channel_conflicts',
            'channel_max_inflight',
            'channel_min_interval',
            'manual_force_unlock',
            'unknown_conflict'
        ]);
        const normalized = String(value || '').trim().toLowerCase();
        return allowed.has(normalized) ? normalized : 'all';
    },

    getDeliveryConflictAuditReasonLabel: function (reasonKey = 'all') {
        const normalized = this.normalizeDeliveryConflictAuditReasonFilter(reasonKey);
        if (normalized === 'target_conflicts') return '目标类冲突';
        if (normalized === 'target_max_inflight') return '目标并发打满';
        if (normalized === 'target_min_interval') return '目标触发间隔限流';
        if (normalized === 'channel_conflicts') return '通道类冲突';
        if (normalized === 'channel_max_inflight') return '通道并发打满';
        if (normalized === 'channel_min_interval') return '通道触发间隔限流';
        if (normalized === 'manual_force_unlock') return '人工强制解锁';
        if (normalized === 'unknown_conflict') return '其他冲突';
        return '全部原因';
    },

    getDeliveryConflictReasonTone: function (reasonKey = 'all') {
        const normalized = this.normalizeDeliveryConflictAuditReasonFilter(reasonKey);
        if (normalized === 'channel_conflicts' || normalized === 'channel_max_inflight') return 'danger';
        if (normalized === 'manual_force_unlock') return 'processing';
        if (normalized === 'unknown_conflict') return 'muted';
        if (normalized === 'target_conflicts') return 'processing';
        if (normalized === 'all') return 'neutral';
        return 'warn';
    },

    getDeliveryTaskStatusFilterMeta: function (status = this.deliveryTaskStatusFilter) {
        const normalized = String(status || 'all').trim().toLowerCase();
        const map = {
            all: { label: '全部状态', tone: 'muted' },
            pending: { label: '待履约', tone: 'warn' },
            processing: { label: '处理中', tone: 'processing' },
            retry_waiting: { label: '待重试', tone: 'warn' },
            requeued: { label: '已重排队', tone: 'processing' },
            dead_letter: { label: '死信', tone: 'danger' },
            delivered: { label: '已履约', tone: 'success' }
        };
        return map[normalized] || { label: normalized || '全部状态', tone: 'neutral' };
    },

    getDeliveryDeadLetterReasonFilterMeta: function (reason = this.deliveryDeadLetterReasonFilter) {
        const normalized = String(reason || 'all').trim().toLowerCase();
        const map = {
            all: { label: '全部原因', tone: 'muted' },
            manual: { label: '人工标记', tone: 'processing' },
            missing_target: { label: '目标缺失', tone: 'danger' },
            timeout: { label: '请求超时', tone: 'warn' },
            upstream_4xx: { label: '上游 4xx', tone: 'danger' },
            upstream_5xx: { label: '上游 5xx', tone: 'danger' },
            max_attempts: { label: '达到最大重试', tone: 'warn' },
            conflict_strategy: { label: '冲突策略', tone: 'warn' },
            network_failure: { label: '网络失败', tone: 'neutral' },
            unknown: { label: '未知原因', tone: 'muted' }
        };
        return map[normalized] || { label: normalized || '全部原因', tone: 'neutral' };
    },

    getDeliveryLockStateFilterMeta: function (lockState = this.deliveryLockStateFilter) {
        const normalized = String(lockState || 'all').trim().toLowerCase();
        const map = {
            all: { label: '全部锁异常', tone: 'muted' },
            active: { label: '仅活跃锁', tone: 'processing' },
            stale: { label: '过期 / 缺锁', tone: 'danger' }
        };
        return map[normalized] || { label: normalized || '全部锁异常', tone: 'neutral' };
    },

    buildDeliveryFilterPreviewText: function (panels = []) {
        const labels = (Array.isArray(panels) ? panels : []).map((panel) => String(panel || '').trim()).filter(Boolean);
        return labels.length ? `影响范围：${labels.join(' / ')}` : '';
    },

    normalizeShopAnalyticsDrilldownContext: function (context = {}) {
        const normalizedContext = context && typeof context === 'object' && !Array.isArray(context)
            ? context
            : null;
        if (!normalizedContext) return null;

        const referenceLabel = String(normalizedContext.referenceLabel || normalizedContext.label || '').trim();
        const referenceValue = String(normalizedContext.referenceValue || normalizedContext.value || '').trim();
        const query = String(
            normalizedContext.query
            || normalizedContext.search
            || normalizedContext.productName
            || normalizedContext.productId
            || ''
        ).trim();
        const queryLabel = String(normalizedContext.queryLabel || '').trim();
        const site = String(normalizedContext.site || '').trim().toLowerCase();
        const productId = String(normalizedContext.productId || '').trim();
        const productName = String(normalizedContext.productName || '').trim();
        const signalSourceName = String(normalizedContext.signalSourceName || '').trim();
        const signalLabel = String(normalizedContext.signalLabel || normalizedContext.targetMetric || '').trim();
        const signalValue = String(normalizedContext.signalValue || '').trim();
        const rangeLabel = String(normalizedContext.rangeLabel || '').trim();
        const userId = String(normalizedContext.userId || '').trim();
        const email = String(normalizedContext.email || '').trim();
        const sourceLabel = String(normalizedContext.sourceLabel || '').trim();
        const summary = String(normalizedContext.summary || '').trim();
        const actionLabel = String(normalizedContext.actionLabel || '').trim();
        const verificationMethod = String(normalizedContext.verificationMethod || '').trim();
        const siteLabel = String(normalizedContext.siteLabel || '').trim();
        const destination = String(normalizedContext.destination || '').trim().toLowerCase();
        const destinationContext = normalizedContext.destinationContext && typeof normalizedContext.destinationContext === 'object' && !Array.isArray(normalizedContext.destinationContext)
            ? { ...normalizedContext.destinationContext }
            : {};

        if (
            !referenceLabel
            && !referenceValue
            && !query
            && !productId
            && !productName
            && !signalSourceName
            && !signalLabel
            && !rangeLabel
            && !userId
            && !email
            && !sourceLabel
            && !summary
            && !actionLabel
            && !verificationMethod
            && !siteLabel
            && !destination
            && !['cn', 'intl'].includes(site)
        ) {
            return null;
        }

        return {
            referenceLabel,
            referenceValue,
            query,
            queryLabel,
            site,
            productId,
            productName,
            signalSourceName,
            signalLabel,
            signalValue,
            rangeLabel,
            userId,
            email,
            sourceLabel,
            summary,
            actionLabel,
            verificationMethod,
            siteLabel,
            destination,
            destinationContext,
            refundStatus: String(normalizedContext.refundStatus || '').trim().toLowerCase(),
            deliveryStatus: String(normalizedContext.deliveryStatus || '').trim().toLowerCase()
        };
    },

    normalizeOrderRefundStatusFilter: function (value = 'all') {
        const normalized = String(value || 'all').trim().toLowerCase();
        return normalized && normalized !== 'all' ? normalized : 'all';
    },

    normalizeOrderDeliveryStatusFilter: function (value = 'all') {
        const normalized = String(value || 'all').trim().toLowerCase();
        const allowed = new Set([
            'all',
            'pending',
            'processing',
            'retry_waiting',
            'requeued',
            'dead_letter',
            'delivered'
        ]);
        return allowed.has(normalized) ? normalized : 'all';
    },

    buildShopAnalyticsDrilldownContextState: function (context = {}, options = {}) {
        const normalizedContext = this.normalizeShopAnalyticsDrilldownContext(context);
        if (!normalizedContext) return null;

        const chips = [{ label: '来源', value: '商品分析' }];
        if (normalizedContext.site === 'cn' || normalizedContext.site === 'intl') {
            chips.push({ label: '站点', value: normalizedContext.site === 'intl' ? 'INTL' : 'CN' });
        }
        if (normalizedContext.referenceLabel && normalizedContext.referenceValue) {
            chips.push({
                label: normalizedContext.referenceLabel,
                value: normalizedContext.referenceValue
            });
        }
        if (normalizedContext.refundStatus && normalizedContext.refundStatus !== 'all') {
            chips.push({
                label: '退款筛选',
                value: normalizedContext.referenceValue || normalizedContext.refundStatus
            });
        }
        if (normalizedContext.deliveryStatus && normalizedContext.deliveryStatus !== 'all') {
            chips.push({
                label: '履约筛选',
                value: normalizedContext.referenceValue || normalizedContext.deliveryStatus
            });
        }
        if (normalizedContext.query) {
            chips.push({
                label: normalizedContext.queryLabel || '当前查询',
                value: normalizedContext.query
            });
        }
        if (normalizedContext.signalLabel) {
            chips.push({
                label: '商品信号',
                value: [normalizedContext.signalLabel, normalizedContext.signalValue].filter(Boolean).join(' · ')
            });
        }
        if (normalizedContext.productName || normalizedContext.productId) {
            chips.push({
                label: '商品',
                value: normalizedContext.productName || normalizedContext.productId
            });
        }
        if (normalizedContext.rangeLabel) {
            chips.push({
                label: '范围',
                value: normalizedContext.rangeLabel
            });
        }

        return {
            eyebrow: String(options.eyebrow || 'Analytics Drilldown').trim() || 'Analytics Drilldown',
            title: String(options.title || '当前来自商品分析下钻').trim() || '当前来自商品分析下钻',
            summary: String(
                options.summary
                || '当前列表由商品分析联动打开，建议先处理当前筛选结果，再继续放大到订单、履约和售后。'
            ).trim(),
            chips
        };
    },

    renderShopAnalyticsDrilldownContextMarkup: function (context = {}, options = {}) {
        const state = this.buildShopAnalyticsDrilldownContextState(context, options);
        if (!state) return '';

        return `
            <div class="admin-workbench-context-note admin-workbench-context-note--compact shop-analytics-drilldown-note">
                <div class="admin-workbench-context-note__eyebrow">${this.escapeHtml(state.eyebrow || 'Analytics Drilldown')}</div>
                <div class="admin-workbench-context-note__title">${this.escapeHtml(state.title || '当前来自商品分析下钻')}</div>
                <div class="admin-workbench-context-note__summary">${this.escapeHtml(state.summary || '')}</div>
                <div class="admin-workbench-context-note__chips">
                    ${(Array.isArray(state.chips) ? state.chips : []).map((item) => `
                        <span class="admin-workbench-context-note__chip">${this.escapeHtml(item.label || '')} · ${this.escapeHtml(item.value || '')}</span>
                    `).join('')}
                </div>
            </div>
        `;
    },

    setOrderSearchContext: function (context = null) {
        this.orderSearchContext = this.normalizeShopAnalyticsDrilldownContext(context);
        this.orderRefundStatusFilter = this.normalizeOrderRefundStatusFilter(this.orderSearchContext?.refundStatus || 'all');
        this.orderDeliveryStatusFilter = this.normalizeOrderDeliveryStatusFilter(this.orderSearchContext?.deliveryStatus || 'all');
        this.syncOrderFilterControls();
        this.renderOrderSearchContextHint();
        this.renderOrderUserFlowSummary([], {
            totalCount: 0,
            loading: Boolean(this.hasUserCommerceOrderContext(this.orderSearchContext))
        });
    },

    clearOrderSearchContext: function (options = {}) {
        const preserveFilters = options && typeof options === 'object' && options.preserveFilters === true;
        if (!preserveFilters) {
            this.orderRefundStatusFilter = 'all';
            this.orderDeliveryStatusFilter = 'all';
        }
        this.currentOrderRows = [];
        this.orderSearchContext = null;
        this.syncOrderFilterControls();
        this.renderOrderSearchContextHint();
        this.renderOrderUserFlowSummary([], {
            totalCount: 0,
            loading: false
        });
    },

    syncOrderFilterControls: function () {
        const refundSelect = document.getElementById('orderRefundStatusFilter');
        if (refundSelect) {
            refundSelect.value = this.normalizeOrderRefundStatusFilter(this.orderRefundStatusFilter);
        }

        const deliverySelect = document.getElementById('orderDeliveryStatusFilter');
        if (deliverySelect) {
            deliverySelect.value = this.normalizeOrderDeliveryStatusFilter(this.orderDeliveryStatusFilter);
        }
    },

    buildUserCommerceReturnContext: function (context = this.orderSearchContext) {
        const normalizedContext = this.normalizeShopAnalyticsDrilldownContext(context);
        if (!normalizedContext || !normalizedContext.userId) {
            return null;
        }

        const userLabel = this.safeText(
            normalizedContext.referenceValue
            || normalizedContext.query
            || normalizedContext.email
            || normalizedContext.userId
            || '当前用户'
        ).trim() || '当前用户';
        const hasIssueFocus = this.normalizeOrderRefundStatusFilter(this.orderRefundStatusFilter) !== 'all'
            || this.normalizeOrderDeliveryStatusFilter(this.orderDeliveryStatusFilter) !== 'all';
        const issueFocusLabel = this.getOrderIssueFocusLabel();

        return {
            sourceLabel: normalizedContext.sourceLabel || '商品经营影响用户',
            summary: hasIssueFocus
                ? `当前已围绕“${issueFocusLabel || '订单问题'}”处理 ${userLabel} 的订单承接链，适合回到用户侧继续确认支付、履约和售后是否同步回落。`
                : (normalizedContext.summary || `当前已按 ${userLabel} 打开商品经营影响用户的订单承接链，适合继续回到用户侧看整体承接是否收口。`),
            signalLabel: normalizedContext.signalLabel,
            signalValue: normalizedContext.signalValue,
            productId: normalizedContext.productId,
            productName: normalizedContext.productName,
            site: normalizedContext.site,
            siteLabel: normalizedContext.siteLabel,
            rangeLabel: normalizedContext.rangeLabel,
            referenceLabel: '用户',
            referenceValue: userLabel,
            actionLabel: normalizedContext.actionLabel || '回到商品经营',
            verificationMethod: normalizedContext.verificationMethod || '回到用户侧确认订单、支付、售后和商品预警是否一起回落。',
            destination: normalizedContext.destination || '',
            destinationContext: normalizedContext.destinationContext || {}
        };
    },

    buildUserCommerceReturnAttrs: function (context = this.orderSearchContext) {
        const normalizedContext = this.normalizeShopAnalyticsDrilldownContext(context);
        const analyticsContext = this.buildUserCommerceReturnContext(normalizedContext);
        if (!normalizedContext?.userId || !analyticsContext) {
            return '';
        }

        const serializedContext = typeof serializeAnalyticsActionContext === 'function'
            ? serializeAnalyticsActionContext(analyticsContext)
            : '';
        return `data-admin-action="analytics-open-user-detail" data-user-id="${this.escapeForAttr(normalizedContext.userId)}"${serializedContext ? ` data-analytics-context="${this.escapeForAttr(serializedContext)}"` : ''}`;
    },

    findCurrentOrderRow: function (orderId = '') {
        const normalizedOrderId = String(orderId || '').trim();
        if (!normalizedOrderId) return null;
        return (Array.isArray(this.currentOrderRows) ? this.currentOrderRows : []).find(
            (row) => String(row?.id || '').trim() === normalizedOrderId
        ) || null;
    },

    recordOrderResolutionFeedback: function (orderId = '', options = {}) {
        if (typeof window.recordAnalyticsResolutionFeedback !== 'function') {
            return null;
        }

        const normalizedContext = this.normalizeShopAnalyticsDrilldownContext(this.orderSearchContext) || {};
        const feedbackScope = String(normalizedContext.feedbackScope || '').trim().toLowerCase();
        const feedbackEntityType = String(normalizedContext.feedbackEntityType || 'shop-orders').trim().toLowerCase() || 'shop-orders';
        const feedbackEntityName = String(
            normalizedContext.feedbackEntityName
            || normalizedContext.referenceValue
            || normalizedContext.referenceLabel
            || normalizedContext.productName
            || normalizedContext.productId
            || '订单承接'
        ).trim() || '订单承接';
        const feedbackEntityId = String(
            normalizedContext.feedbackEntityId
            || orderId
            || feedbackEntityType
        ).trim() || feedbackEntityType;
        if (!normalizedContext.productId && !normalizedContext.productName && !feedbackScope && !feedbackEntityName) {
            return null;
        }

        const order = this.findCurrentOrderRow(orderId) || {};
        const targetStatus = String(options.targetStatus || '').trim().toLowerCase();
        const targetStatusLabelMap = {
            available: '重新上架',
            frozen: '冻结问题',
            fault: '故障维修',
            reserve: '保留库存'
        };
        const targetStatusLabel = targetStatusLabelMap[targetStatus] || '库存已调整';
        const referenceLabel = String(normalizedContext.referenceLabel || '用户').trim() || '用户';
        const referenceValue = String(
            normalizedContext.referenceValue
            || normalizedContext.query
            || normalizedContext.email
            || normalizedContext.userId
            || orderId
        ).trim() || orderId;
        const productLabel = String(
            order?.product_name
            || order?.name
            || order?.product_title
            || normalizedContext.productName
            || normalizedContext.productId
            || '当前商品'
        ).trim();

        return window.recordAnalyticsResolutionFeedback({
            module: 'shop-orders',
            productId: normalizedContext.productId,
            productName: normalizedContext.productName || productLabel,
            feedbackScope,
            entityType: feedbackEntityType,
            entityId: feedbackEntityId,
            entityName: feedbackEntityName,
            title: `订单退款 · ${productLabel}`,
            summary: `${referenceLabel}“${referenceValue}”的订单 ${String(orderId || '').trim() || '—'} 已完成退款，并将库存切到“${targetStatusLabel}”。建议回到用户侧确认退款问题没有继续新增。`,
            actionLabel: '订单退款',
            referenceLabel,
            referenceValue,
            tone: 'warning',
            statusKey: 'review',
            statusLabel: '待复查'
        });
    },

    renderOrderSearchContextHint: function () {
        const container = document.getElementById('shopOrdersContextHint');
        if (!container) return;

        const hasUserContext = this.hasUserCommerceOrderContext(this.orderSearchContext);

        const markup = this.renderShopAnalyticsDrilldownContextMarkup(this.orderSearchContext, {
            title: hasUserContext ? '当前订单列表来自商品经营影响用户' : '当前订单列表来自商品分析下钻',
            summary: hasUserContext
                ? '已按这位受商品经营影响用户联动筛选订单列表，适合继续核对订单、退款、履约和售后承接。'
                : '已按商品或关键词联动筛选订单列表，你可以继续看订单明细、退款、导出或改查询脱离当前上下文。'
        });
        const userReturnAttrs = this.buildUserCommerceReturnAttrs(this.orderSearchContext);
        container.innerHTML = markup && userReturnAttrs
            ? markup.replace(
                '<div class="admin-workbench-context-note__chips">',
                `<div class="admin-workbench-context-note__chips">
                    <button
                        type="button"
                        class="admin-workbench-context-note__chip admin-workbench-context-note__chip--action"
                        ${userReturnAttrs}
                    >回用户承接链</button>`
            )
            : markup;
        container.hidden = !markup;
    },

    hasUserCommerceOrderContext: function (context = this.orderSearchContext) {
        const normalizedContext = this.normalizeShopAnalyticsDrilldownContext(context);
        if (!normalizedContext) {
            return false;
        }

        const labels = [
            this.safeText(normalizedContext.queryLabel).trim(),
            this.safeText(normalizedContext.referenceLabel).trim()
        ].filter(Boolean);

        return labels.includes('用户') || labels.includes('User') || Boolean(normalizedContext.userId || normalizedContext.email);
    },

    applyOrderUserFlowFocus: function (rawKind, rawValue) {
        const kind = String(rawKind || '').trim().toLowerCase();
        const value = String(rawValue || '').trim().toLowerCase();

        if (kind === 'refund') {
            this.orderRefundStatusFilter = this.normalizeOrderRefundStatusFilter(value || 'all');
            this.orderDeliveryStatusFilter = 'all';
        } else if (kind === 'delivery') {
            this.orderDeliveryStatusFilter = this.normalizeOrderDeliveryStatusFilter(value || 'all');
            this.orderRefundStatusFilter = 'all';
        } else {
            this.orderRefundStatusFilter = 'all';
            this.orderDeliveryStatusFilter = 'all';
        }

        this.syncOrderFilterControls();
        this.searchOrders(1);
    },

    buildOrderUserFlowDestinationContext: function (destination = '', item = {}) {
        const normalizedDestination = String(destination || '').trim().toLowerCase();
        const context = this.normalizeShopAnalyticsDrilldownContext(this.orderSearchContext) || {};
        const userLabel = this.safeText(
            context.referenceValue
            || context.query
            || context.email
            || context.userId
            || '当前用户'
        ).trim() || '当前用户';
        const query = this.safeText(context.query || context.email || context.userId).trim();
        const issueKind = this.safeText(item.issueKind).trim().toLowerCase();
        const issueValue = this.safeText(item.issueValue).trim().toLowerCase();
        const issueLabel = this.safeText(item.title).trim() || '订单承接链';

        const baseContext = {
            referenceLabel: '用户',
            referenceValue: userLabel,
            query,
            queryLabel: '用户',
            site: this.safeText(context.site).trim().toLowerCase(),
            siteLabel: this.safeText(context.siteLabel).trim(),
            productId: this.safeText(context.productId).trim(),
            productName: this.safeText(context.productName).trim(),
            userId: this.safeText(context.userId).trim(),
            email: this.safeText(context.email).trim(),
            signalLabel: this.safeText(context.signalLabel).trim(),
            signalValue: this.safeText(context.signalValue).trim(),
            rangeLabel: this.safeText(context.rangeLabel).trim(),
            sourceLabel: this.safeText(context.sourceLabel).trim() || '商品经营影响用户',
            summary: this.safeText(context.summary).trim() || `当前已围绕 ${userLabel} 的订单承接链继续核对支付、履约和售后问题。`,
            actionLabel: this.safeText(context.actionLabel).trim() || '回到商品经营',
            verificationMethod: this.safeText(context.verificationMethod).trim() || '处理后回看用户侧承接链、订单问题和商品预警是否同步回落。',
            destination: this.safeText(context.destination).trim().toLowerCase(),
            destinationContext: context.destinationContext && typeof context.destinationContext === 'object' && !Array.isArray(context.destinationContext)
                ? { ...context.destinationContext }
                : {}
        };

        if (normalizedDestination === 'tickets') {
            return {
                ...baseContext,
                mode: 'pending',
                workspace: 'queue',
                search: query || userLabel,
                focusTargetId: 'ticketsIssueSummary',
                issueSource: 'shop-order-user-flow',
                issueKind,
                issueValue,
                contextTitle: issueLabel
            };
        }

        if (normalizedDestination === 'payments-ops') {
            return {
                ...baseContext,
                mode: 'ops',
                focusTargetId: issueKind === 'refund' ? 'paymentsPrioritySummary' : 'paymentsIssueSummary',
                topicKey: issueKind === 'refund' ? 'refund_failures' : '',
                issueSource: 'shop-order-user-flow',
                issueKind,
                issueValue,
                contextTitle: issueLabel
            };
        }

        if (normalizedDestination === 'payments-overview') {
            return {
                ...baseContext,
                mode: 'overview',
                focusTargetId: 'paymentsIssueSummary',
                issueSource: 'shop-order-user-flow',
                issueKind,
                issueValue,
                contextTitle: issueLabel
            };
        }

        return {
            ...baseContext,
            issueSource: 'shop-order-user-flow',
            issueKind,
            issueValue,
            contextTitle: issueLabel
        };
    },

    openOrderUserFlowDestination: function (destination = '', rawKind = '', rawValue = '') {
        const normalizedDestination = String(destination || '').trim().toLowerCase();
        if (!normalizedDestination || typeof window.openAnalyticsDestination !== 'function') {
            return;
        }

        const issueKind = String(rawKind || '').trim().toLowerCase();
        const issueValue = String(rawValue || '').trim().toLowerCase();
        const issueLabels = {
            refund: '退款相关订单',
            delivery_dead_letter: '履约死信订单',
            delivery_retry_waiting: '待重试订单',
            delivery_pending: '待履约订单',
            delivery_delivered: '已履约订单'
        };
        const issueKey = issueKind === 'refund'
            ? 'refund'
            : `delivery_${issueValue || issueKind}`;
        const context = this.buildOrderUserFlowDestinationContext(normalizedDestination, {
            issueKind,
            issueValue,
            title: issueLabels[issueKey] || '订单承接链'
        });
        window.openAnalyticsDestination(normalizedDestination, context);
    },

    renderOrderUserFlowSummary: function (rows = [], options = {}) {
        const container = document.getElementById('shopOrdersUserFlowSummary');
        if (!container) return;

        if (!this.hasUserCommerceOrderContext()) {
            container.innerHTML = '';
            container.hidden = true;
            return;
        }

        const safeRows = Array.isArray(rows) ? rows : [];
        const matchedCount = Number(options.totalCount);
        const totalCount = Number.isFinite(matchedCount) ? matchedCount : safeRows.length;
        const isLoading = options.loading === true;
        const userLabel = this.safeText(
            this.orderSearchContext?.referenceValue
            || this.orderSearchContext?.query
            || this.orderSearchContext?.email
            || this.orderSearchContext?.userId
            || '当前用户'
        ).trim() || '当前用户';
        const refundedCount = safeRows.filter((row) => ['refunded', 'full_refund'].includes(String(row?.refund_status || '').trim().toLowerCase())).length;
        const deadLetterCount = safeRows.filter((row) => String(row?.delivery_status || '').trim().toLowerCase() === 'dead_letter').length;
        const retryWaitingCount = safeRows.filter((row) => String(row?.delivery_status || '').trim().toLowerCase() === 'retry_waiting').length;
        const pendingDeliveryCount = safeRows.filter((row) => String(row?.delivery_status || '').trim().toLowerCase() === 'pending').length;
        const deliveredCount = safeRows.filter((row) => String(row?.delivery_status || '').trim().toLowerCase() === 'delivered').length;
        const uniqueProducts = new Set(
            safeRows
                .map((row) => this.safeText(row?.product_name || row?.name || row?.product_title).trim())
                .filter(Boolean)
        );
        const latestProduct = safeRows
            .map((row) => this.safeText(row?.product_name || row?.name || row?.product_title).trim())
            .find(Boolean);
        const userReturnAttrs = this.buildUserCommerceReturnAttrs(this.orderSearchContext);
        const chips = [
            { label: '用户', value: userLabel },
            this.orderSearchContext?.signalLabel
                ? { label: '商品信号', value: [this.orderSearchContext.signalLabel, this.orderSearchContext.signalValue].filter(Boolean).join(' · ') }
                : null,
            this.orderSearchContext?.productName || this.orderSearchContext?.productId
                ? { label: '当前商品', value: this.orderSearchContext.productName || this.orderSearchContext.productId }
                : null,
            this.orderSearchContext?.rangeLabel
                ? { label: '范围', value: this.orderSearchContext.rangeLabel }
                : null,
            { label: '命中订单', value: String(totalCount || 0) },
            { label: '涉及商品', value: String(uniqueProducts.size || 0) },
            refundedCount > 0 ? { label: '退款相关', value: String(refundedCount) } : null,
            deadLetterCount > 0 ? { label: '死信', value: String(deadLetterCount) } : null,
            retryWaitingCount > 0 ? { label: '待重试', value: String(retryWaitingCount) } : null,
            pendingDeliveryCount > 0 ? { label: '待履约', value: String(pendingDeliveryCount) } : null,
            deliveredCount > 0 ? { label: '已履约', value: String(deliveredCount) } : null
        ].filter(Boolean);
        const priorityCandidates = totalCount > 0
            ? [
                {
                    key: 'refund',
                    count: refundedCount,
                    rank: 'TOP 1',
                    title: '退款相关订单',
                    whyImportant: '退款说明这位用户虽然已经成交，但承接链已经反向失败，最容易把本轮经营结论重新拉回待复查。',
                    nextAction: '先核对退款订单是否已经完成库存回滚、售后回复和状态同步，避免已退款但仍挂在待复查里。',
                    verification: '处理后回看这位用户的退款订单是否不再新增，同时确认商品预警里的退款风险开始回落。',
                    issueKind: 'refund',
                    issueValue: 'refunded'
                },
                {
                    key: 'dead_letter',
                    count: deadLetterCount,
                    rank: 'TOP 2',
                    title: '履约死信订单',
                    whyImportant: '死信说明支付后的履约承接彻底中断，会直接影响用户体验并放大售后压力。',
                    nextAction: '优先检查死信订单的上游失败或目标缺失，先把订单移出死信再继续核对售后承接。',
                    verification: '处理后确认死信订单已转出死信，待重试/处理中样本开始回落，履约风险不再持续挂红。',
                    issueKind: 'delivery',
                    issueValue: 'dead_letter'
                },
                {
                    key: 'retry_waiting',
                    count: retryWaitingCount,
                    rank: 'TOP 3',
                    title: '待重试订单',
                    whyImportant: '待重试说明这条订单链还有恢复空间，越早清理越能缩短这位用户的等待时间。',
                    nextAction: '先确认失败原因和重试条件，优先把待重试订单推回处理中或已履约。',
                    verification: '处理后回看待重试订单是否减少，且没有继续掉回相同的重试状态。',
                    issueKind: 'delivery',
                    issueValue: 'retry_waiting'
                },
                {
                    key: 'pending',
                    count: pendingDeliveryCount,
                    rank: 'TOP 4',
                    title: '待履约订单',
                    whyImportant: '待履约偏多说明支付后的承接链没有顺畅推进，容易拖慢整条商品承接链。',
                    nextAction: '先回看当前商品和站点的履约入口是否拥堵，再确认是否有库存或渠道侧阻塞。',
                    verification: '处理后确认待履约订单开始转向处理中或已履约，且不会继续堆积。',
                    issueKind: 'delivery',
                    issueValue: 'pending'
                },
                {
                    key: 'delivered',
                    count: deliveredCount,
                    rank: 'TOP 5',
                    title: '已履约订单',
                    whyImportant: '已履约样本能帮助确认这条承接链是否真的收口，还是在履约后又转成售后或退款问题。',
                    nextAction: '回看已履约样本是否已经沉淀成复购或售后问题，确认这位用户的承接链是否真正收口。',
                    verification: '处理后确认已履约订单没有继续转成退款或售后异常，并开始沉淀成稳定复购样本。',
                    issueKind: 'delivery',
                    issueValue: 'delivered'
                }
            ]
                .filter((item) => item.count > 0)
                .sort((left, right) => {
                    const weight = {
                        refund: 500,
                        dead_letter: 400,
                        retry_waiting: 300,
                        pending: 200,
                        delivered: 100
                    };
                    return (weight[right.key] + right.count) - (weight[left.key] + left.count);
                })
                .slice(0, 3)
            : [];
        const summary = isLoading
            ? `正在按“${userLabel}”回看商品承接后的订单链路，订单样本返回后会补齐退款、履约和商品分布摘要。`
            : (totalCount > 0
                ? `这位受商品经营影响的用户当前命中 ${totalCount} 笔订单，涉及 ${uniqueProducts.size || 0} 个商品${latestProduct ? `，最近订单商品是「${latestProduct}」` : ''}，适合继续核对退款、履约和售后承接。`
                : '这位用户已命中商品经营信号，但当前订单侧还没有形成样本，建议继续回看支付、积分或售后承接。');

        container.innerHTML = `
            <div class="admin-workbench-context-note admin-workbench-context-note--compact shop-analytics-drilldown-note shop-analytics-drilldown-note--issue">
                <div class="admin-workbench-context-note__eyebrow">User Commerce View</div>
                <div class="admin-workbench-context-note__title">${this.escapeHtml(`${userLabel} · 订单承接链`)}</div>
                <div class="admin-workbench-context-note__summary">${this.escapeHtml(summary)}</div>
                <div class="admin-workbench-context-note__chips">
                    ${chips.map((item) => `
                        <span class="admin-workbench-context-note__chip">${this.escapeHtml(item.label)} · ${this.escapeHtml(item.value)}</span>
                    `).join('')}
                </div>
                ${(!isLoading && priorityCandidates.length > 0) ? `
                    <div class="admin-workbench-priority-list">
                        ${priorityCandidates.map((item, index) => `
                            <div class="admin-workbench-priority-item">
                                <div class="admin-workbench-priority-item__top">
                                    <div class="admin-workbench-priority-item__title">${this.escapeHtml(item.title)}</div>
                                    <div class="admin-workbench-priority-item__rank">${this.escapeHtml(item.rank || `TOP ${index + 1}`)}</div>
                                </div>
                                <div class="admin-workbench-priority-item__meta">
                                    <span>命中订单 ${this.escapeHtml(String(item.count || 0))}</span>
                                    <span>用户 ${this.escapeHtml(userLabel)}</span>
                                </div>
                                <div class="admin-workbench-priority-item__guidance">
                                    <div class="admin-workbench-priority-item__guidance-item">
                                        <span>为什么优先</span>
                                        <p>${this.escapeHtml(item.whyImportant || '')}</p>
                                    </div>
                                    <div class="admin-workbench-priority-item__guidance-item">
                                        <span>建议先做</span>
                                        <p>${this.escapeHtml(item.nextAction || item.recommendation || '')}</p>
                                    </div>
                                    <div class="admin-workbench-priority-item__guidance-item">
                                        <span>验证方式</span>
                                        <p>${this.escapeHtml(item.verification || '处理后回看这位用户的订单、支付和售后信号是否开始回落。')}</p>
                                    </div>
                                </div>
                                <div class="admin-workbench-priority-item__actions">
                                    ${userReturnAttrs ? `
                                        <button
                                            type="button"
                                            class="admin-workbench-priority-item__btn"
                                            ${userReturnAttrs}
                                        >
                                            <i class="fas fa-user"></i> 回用户承接链
                                        </button>
                                    ` : ''}
                                    <button
                                        type="button"
                                        class="admin-workbench-priority-item__btn"
                                        data-shop-action="order-user-flow-focus"
                                        data-order-issue-kind="${this.escapeForAttr(item.issueKind || '')}"
                                        data-order-issue-value="${this.escapeForAttr(item.issueValue || '')}"
                                    >
                                        <i class="fas fa-list-check"></i> 看${this.escapeHtml(item.title)}
                                    </button>
                                    <button
                                        type="button"
                                        class="admin-workbench-priority-item__btn"
                                        data-shop-action="order-user-flow-open-destination"
                                        data-analytics-destination="${this.escapeForAttr(item.issueKind === 'refund' ? 'payments-ops' : 'payments-overview')}"
                                        data-order-issue-kind="${this.escapeForAttr(item.issueKind || '')}"
                                        data-order-issue-value="${this.escapeForAttr(item.issueValue || '')}"
                                    >
                                        <i class="fas fa-credit-card"></i> 看支付问题
                                    </button>
                                    <button
                                        type="button"
                                        class="admin-workbench-priority-item__btn"
                                        data-shop-action="order-user-flow-open-destination"
                                        data-analytics-destination="tickets"
                                        data-order-issue-kind="${this.escapeForAttr(item.issueKind || '')}"
                                        data-order-issue-value="${this.escapeForAttr(item.issueValue || '')}"
                                    >
                                        <i class="fas fa-life-ring"></i> 看售后工单
                                    </button>
                                    <button
                                        type="button"
                                        class="admin-workbench-priority-item__btn"
                                        data-shop-action="order-user-flow-focus"
                                        data-order-issue-kind="reset"
                                        data-order-issue-value="all"
                                    >
                                        <i class="fas fa-arrows-rotate"></i> 回到全部订单
                                    </button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        `;
        container.hidden = false;
    },

    buildOrderIssueGuidanceState: function ({ refundStatus = 'all', deliveryStatus = 'all', totalCount = 0 } = {}) {
        const normalizedRefundStatus = this.normalizeOrderRefundStatusFilter(refundStatus);
        const normalizedDeliveryStatus = this.normalizeOrderDeliveryStatusFilter(deliveryStatus);

        if (normalizedRefundStatus !== 'all') {
            return {
                issueKind: 'refund',
                issueValue: 'refunded',
                whyImportant: `当前窗口命中 ${totalCount || 0} 笔退款相关订单，说明这位受商品经营影响用户的成交承接已经反向转成售后问题。`,
                nextAction: '先核对退款状态、库存回滚和售后回复是否已经同步，再决定是否继续追支付或售后。',
                verification: '处理后回看退款相关订单是否不再新增，并确认商品预警里的退款风险开始回落。'
            };
        }

        const deliveryGuidanceMap = {
            dead_letter: {
                whyImportant: `当前窗口命中 ${totalCount || 0} 笔履约死信订单，说明订单已经卡在承接链最危险的断点。`,
                nextAction: '先排查死信原因并把订单移出死信，再继续回看支付与售后是否同步收口。',
                verification: '处理后确认死信订单转出死信，且这位用户的履约风险不再持续新增。'
            },
            retry_waiting: {
                whyImportant: `当前窗口命中 ${totalCount || 0} 笔待重试订单，说明这条链路还有恢复空间，但还没有真正收口。`,
                nextAction: '先确认失败原因和重试条件，优先把待重试订单推回处理中或已履约。',
                verification: '处理后回看待重试订单是否减少，且没有继续掉回相同的重试状态。'
            },
            pending: {
                whyImportant: `当前窗口命中 ${totalCount || 0} 笔待履约订单，说明支付后的承接还停在中间环节。`,
                nextAction: '先核对库存、目标渠道和履约入口是否堵塞，再决定是否需要人工介入履约。',
                verification: '处理后确认待履约订单开始转向处理中或已履约，且不会继续堆积。'
            },
            delivered: {
                whyImportant: `当前窗口命中 ${totalCount || 0} 笔已履约订单，适合回看这条链路是否已经真正沉淀成稳定结果。`,
                nextAction: '先抽样核对已履约订单是否又转成退款或售后问题，确认承接链已经真正收口。',
                verification: '处理后确认已履约订单没有继续反弹成退款/售后，并逐步沉淀成稳定复购信号。'
            }
        };

        if (normalizedDeliveryStatus !== 'all' && deliveryGuidanceMap[normalizedDeliveryStatus]) {
            return {
                issueKind: 'delivery',
                issueValue: normalizedDeliveryStatus,
                ...deliveryGuidanceMap[normalizedDeliveryStatus]
            };
        }

        return {
            issueKind: '',
            issueValue: '',
            whyImportant: `当前窗口命中 ${totalCount || 0} 笔问题订单，适合优先处理这位用户当前最影响商品承接链的问题。`,
            nextAction: '先看当前订单问题类型，再决定优先去支付、履约还是售后继续处理。',
            verification: '处理后回看问题订单是否开始减少，并确认用户侧的商品承接链开始回落。'
        };
    },

    getOrderIssueFocusLabel: function () {
        const refundStatus = this.normalizeOrderRefundStatusFilter(this.orderRefundStatusFilter);
        const deliveryStatus = this.normalizeOrderDeliveryStatusFilter(this.orderDeliveryStatusFilter);
        const refundLabel = refundStatus !== 'all'
            ? (this.orderSearchContext?.referenceValue || '退款问题')
            : '';
        const deliveryLabelMap = {
            pending: '待履约',
            processing: '履约中',
            retry_waiting: '待重试',
            requeued: '已重排队',
            dead_letter: '死信',
            delivered: '已履约'
        };
        const deliveryLabel = deliveryStatus !== 'all'
            ? (this.orderSearchContext?.referenceValue || deliveryLabelMap[deliveryStatus] || '履约问题')
            : '';

        if (refundLabel && deliveryLabel) {
            return `${refundLabel} / ${deliveryLabel}`;
        }
        return refundLabel || deliveryLabel || '';
    },

    renderOrderIssueSummary: function (rows = [], options = {}) {
        const container = document.getElementById('shopOrdersIssueSummary');
        if (!container) return;

        const refundStatus = this.normalizeOrderRefundStatusFilter(this.orderRefundStatusFilter);
        const deliveryStatus = this.normalizeOrderDeliveryStatusFilter(this.orderDeliveryStatusFilter);
        const hasIssueFocus = refundStatus !== 'all' || deliveryStatus !== 'all';
        if (!hasIssueFocus) {
            container.innerHTML = '';
            container.hidden = true;
            return;
        }

        const safeRows = Array.isArray(rows) ? rows : [];
        const matchedCount = Number(options.totalCount);
        const totalCount = Number.isFinite(matchedCount) ? matchedCount : safeRows.length;
        const refundCount = safeRows.filter((row) => ['refunded', 'full_refund'].includes(String(row?.refund_status || '').trim().toLowerCase())).length;
        const deadLetterCount = safeRows.filter((row) => String(row?.delivery_status || '').trim().toLowerCase() === 'dead_letter').length;
        const retryCount = safeRows.filter((row) => String(row?.delivery_status || '').trim().toLowerCase() === 'retry_waiting').length;
        const pendingCount = safeRows.filter((row) => String(row?.delivery_status || '').trim().toLowerCase() === 'pending').length;
        const issueFocusLabel = this.getOrderIssueFocusLabel() || '问题订单';
        const guidanceState = this.buildOrderIssueGuidanceState({
            refundStatus,
            deliveryStatus,
            totalCount
        });
        const userReturnAttrs = this.buildUserCommerceReturnAttrs(this.orderSearchContext);
        const chips = [
            { label: '命中订单', value: String(totalCount || 0) },
            { label: '退款订单', value: String(refundCount || 0) },
            { label: '死信订单', value: String(deadLetterCount || 0) },
            { label: '待重试', value: String(retryCount || 0) },
            { label: '待履约', value: String(pendingCount || 0) }
        ].filter((item) => item.value !== '0' || item.label === '命中订单');

        container.innerHTML = `
            <div class="admin-workbench-context-note admin-workbench-context-note--compact shop-analytics-drilldown-note shop-analytics-drilldown-note--issue">
                <div class="admin-workbench-context-note__eyebrow">Order Issue View</div>
                <div class="admin-workbench-context-note__title">${this.escapeHtml(`${issueFocusLabel} · 订单问题列表`)}</div>
                <div class="admin-workbench-context-note__summary">当前订单列表已切到问题视角，适合优先处理退款、死信、待重试和待履约订单。</div>
                <div class="admin-workbench-context-note__chips">
                    ${chips.map((item) => `
                        <span class="admin-workbench-context-note__chip">${this.escapeHtml(item.label)} · ${this.escapeHtml(item.value)}</span>
                    `).join('')}
                </div>
                <div class="admin-workbench-priority-item__guidance shop-order-issue-guidance">
                    <div class="admin-workbench-priority-item__guidance-item">
                        <span>为什么优先</span>
                        <p>${this.escapeHtml(guidanceState?.whyImportant || '当前订单列表已经聚焦到关键问题样本，适合优先处理。')}</p>
                    </div>
                    <div class="admin-workbench-priority-item__guidance-item">
                        <span>建议先做</span>
                        <p>${this.escapeHtml(guidanceState?.nextAction || '先核对当前问题类型，再决定优先回看支付、履约还是售后。')}</p>
                    </div>
                    <div class="admin-workbench-priority-item__guidance-item">
                        <span>验证方式</span>
                        <p>${this.escapeHtml(guidanceState?.verification || '处理后回看当前问题订单是否开始减少，并确认用户商品承接链开始回落。')}</p>
                    </div>
                </div>
                <div class="admin-workbench-priority-item__actions shop-order-issue-actions">
                    ${userReturnAttrs ? `
                        <button
                            type="button"
                            class="admin-workbench-priority-item__btn"
                            ${userReturnAttrs}
                        >
                            <i class="fas fa-user"></i> 回用户承接链
                        </button>
                    ` : ''}
                    <button
                        type="button"
                        class="admin-workbench-priority-item__btn"
                        data-shop-action="order-user-flow-open-destination"
                        data-analytics-destination="${this.escapeForAttr(guidanceState?.issueKind === 'refund' ? 'payments-ops' : 'payments-overview')}"
                        data-order-issue-kind="${this.escapeForAttr(guidanceState?.issueKind || '')}"
                        data-order-issue-value="${this.escapeForAttr(guidanceState?.issueValue || '')}"
                    >
                        <i class="fas fa-credit-card"></i> 看支付问题
                    </button>
                    <button
                        type="button"
                        class="admin-workbench-priority-item__btn"
                        data-shop-action="order-user-flow-open-destination"
                        data-analytics-destination="tickets"
                        data-order-issue-kind="${this.escapeForAttr(guidanceState?.issueKind || '')}"
                        data-order-issue-value="${this.escapeForAttr(guidanceState?.issueValue || '')}"
                    >
                        <i class="fas fa-life-ring"></i> 看售后工单
                    </button>
                    <button
                        type="button"
                        class="admin-workbench-priority-item__btn"
                        data-shop-action="order-user-flow-focus"
                        data-order-issue-kind="reset"
                        data-order-issue-value="all"
                    >
                        <i class="fas fa-arrows-rotate"></i> 回到全部订单
                    </button>
                </div>
            </div>
        `;
        container.hidden = false;
    },

    getDeliveryIssueFocusLabel: function () {
        const taskStatusMeta = this.getDeliveryTaskStatusFilterMeta(this.deliveryTaskStatusFilter);
        const deadLetterReasonMeta = this.getDeliveryDeadLetterReasonFilterMeta(this.deliveryDeadLetterReasonFilter);
        const deliveryStatus = String(this.deliveryWorkbenchContext?.deliveryStatus || '').trim().toLowerCase();
        const queryLabel = String(this.deliveryTaskQueryContext?.label || this.deliveryWorkbenchContext?.queryLabel || '').trim();

        if (String(this.deliveryDeadLetterReasonFilter || 'all').trim().toLowerCase() !== 'all') {
            return deadLetterReasonMeta.label || '死信问题';
        }

        if (String(this.deliveryTaskStatusFilter || 'all').trim().toLowerCase() !== 'all') {
            return this.deliveryWorkbenchContext?.referenceValue || taskStatusMeta.label || '履约问题';
        }

        if (deliveryStatus && this.deliveryWorkbenchContext?.referenceValue) {
            return this.deliveryWorkbenchContext.referenceValue;
        }

        if (queryLabel) return queryLabel;
        if (this.deliveryWorkbenchContext?.referenceValue) return this.deliveryWorkbenchContext.referenceValue;
        if (this.deliveryWorkbenchContext?.referenceLabel) return this.deliveryWorkbenchContext.referenceLabel;
        return '';
    },

    renderDeliveryIssueSummary: function (summary = {}) {
        const container = document.getElementById('deliveryIssueSummary');
        if (!container) return;

        const hasWorkbenchContext = Boolean(this.deliveryWorkbenchContext);
        const hasIssueFilters = String(this.deliveryTaskStatusFilter || 'all').trim().toLowerCase() !== 'all'
            || String(this.deliveryDeadLetterReasonFilter || 'all').trim().toLowerCase() !== 'all';

        if (!hasWorkbenchContext && !hasIssueFilters) {
            container.innerHTML = '';
            container.hidden = true;
            return;
        }

        const focusLabel = this.getDeliveryIssueFocusLabel() || '履约问题';
        const chips = [
            { label: '命中任务', value: Number(summary.total || 0) },
            { label: '待履约', value: Number(summary.pending || 0) },
            { label: '处理中', value: Number(summary.processing || 0) },
            { label: '待重试', value: Number(summary.retry_waiting || 0) },
            { label: '死信', value: Number(summary.dead_letter || 0) },
            { label: '冲突任务', value: Number(summary.conflict_tasks || 0) },
            { label: '待解锁', value: Number(summary.force_unlock_candidates || 0) }
        ].filter((item) => item.value > 0 || item.label === '命中任务');
        const currentTaskStatus = String(this.deliveryTaskStatusFilter || 'all').trim().toLowerCase();
        const currentLockState = String(this.deliveryLockStateFilter || 'all').trim().toLowerCase();
        const hasActiveQuickFocus = currentTaskStatus !== 'all' || currentLockState !== 'all';
        const quickFilters = [
            {
                label: `待履约 ${Number(summary.pending || 0)}`,
                tone: 'warn',
                active: currentTaskStatus === 'pending',
                value: 'pending',
                kind: 'status',
                title: '点击快速切到待履约任务'
            },
            {
                label: `处理中 ${Number(summary.processing || 0)}`,
                tone: 'processing',
                active: currentTaskStatus === 'processing',
                value: 'processing',
                kind: 'status',
                title: '点击快速切到处理中任务'
            },
            {
                label: `待重试 ${Number(summary.retry_waiting || 0)}`,
                tone: 'warn',
                active: currentTaskStatus === 'retry_waiting',
                value: 'retry_waiting',
                kind: 'status',
                title: '点击快速切到待重试任务'
            },
            {
                label: `死信 ${Number(summary.dead_letter || 0)}`,
                tone: 'danger',
                active: currentTaskStatus === 'dead_letter',
                value: 'dead_letter',
                kind: 'status',
                title: '点击快速切到死信任务'
            },
            {
                label: `待解锁 ${Number(summary.force_unlock_candidates || 0)}`,
                tone: 'danger',
                active: currentLockState === 'stale',
                value: 'stale',
                kind: 'lock',
                title: '点击快速切到待解锁锁异常视角'
            }
        ];
        const priorityCandidates = [
            {
                key: 'dead_letter',
                count: Number(summary.dead_letter || 0),
                tone: 'danger',
                title: '死信任务会阻塞履约闭环，建议优先检查上游永久失败、目标缺失和冲突策略。',
                label: '死信任务'
            },
            {
                key: 'force_unlock',
                count: Number(summary.force_unlock_candidates || 0),
                tone: 'danger',
                title: '待解锁通常意味着过期锁或缺锁残留，建议优先解除阻塞，避免队列继续卡住。',
                label: '待解锁'
            },
            {
                key: 'retry_waiting',
                count: Number(summary.retry_waiting || 0),
                tone: 'warn',
                title: '待重试代表任务还可恢复，适合在死信之后优先清理，缩短用户等待。',
                label: '待重试'
            },
            {
                key: 'processing',
                count: Number(summary.processing || 0),
                tone: 'processing',
                title: '处理中任务堆积时，说明当前吞吐或锁竞争需要关注。',
                label: '处理中'
            },
            {
                key: 'pending',
                count: Number(summary.pending || 0),
                tone: 'warn',
                title: '待履约偏高时，说明新任务在入口堆积，建议核查扫描与批次策略。',
                label: '待履约'
            }
        ]
            .filter((item) => item.count > 0)
            .sort((left, right) => {
                const weight = {
                    dead_letter: 500,
                    force_unlock: 400,
                    retry_waiting: 300,
                    processing: 200,
                    pending: 100
                };
                return (weight[right.key] + right.count) - (weight[left.key] + left.count);
            })
            .slice(0, 3);
        const priorityActionForKey = (key) => {
            if (key === 'force_unlock') {
                return {
                    action: 'delivery-priority-action',
                    actionAttrs: {
                        'delivery-priority-key': 'force_unlock'
                    }
                };
            }
            return {
                action: 'delivery-priority-action',
                actionAttrs: {
                    'delivery-priority-key': key
                }
            };
        };

        container.innerHTML = `
            <div class="admin-workbench-context-note admin-workbench-context-note--compact shop-analytics-drilldown-note shop-analytics-drilldown-note--issue">
                <div class="admin-workbench-context-note__eyebrow">Fulfillment Issue View</div>
                <div class="admin-workbench-context-note__title">${this.escapeHtml(`${focusLabel} · 履约问题列表`)}</div>
                <div class="admin-workbench-context-note__summary">当前履约列表已切到问题视角，适合优先处理待履约、处理中、待重试和死信任务。</div>
                ${priorityCandidates.length ? `
                    <div class="analytics-product-detail-subsection">
                        <span class="analytics-product-detail-subsection__label">建议先处理</span>
                        <div class="admin-workbench-context-note__chips">
                            ${priorityCandidates.map((item) => {
                                const actionConfig = priorityActionForKey(item.key);
                                return this.renderDeliveryQuickFilterChip({
                                    label: `${item.label} ${item.count}`,
                                    tone: item.tone,
                                    active: item.key === 'force_unlock'
                                        ? currentLockState === 'stale'
                                        : currentTaskStatus === item.key,
                                    title: item.title,
                                    action: actionConfig.action,
                                    actionAttrs: actionConfig.actionAttrs
                                });
                            }).join('')}
                        </div>
                    </div>
                ` : ''}
                <div class="admin-workbench-context-note__chips">
                    ${chips.map((item) => `
                        <span class="admin-workbench-context-note__chip">${this.escapeHtml(item.label)} · ${this.escapeHtml(String(item.value || 0))}</span>
                    `).join('')}
                </div>
                <div class="admin-workbench-context-note__chips">
                    ${hasActiveQuickFocus ? this.renderDeliveryQuickFilterChip({
                        label: '全部任务',
                        tone: 'neutral',
                        active: !hasActiveQuickFocus,
                        title: '清除履约问题摘要快捷切换',
                        action: 'delivery-issue-summary-focus',
                        actionAttrs: {
                            'delivery-issue-focus-kind': 'status',
                            'delivery-issue-focus-value': 'all'
                        }
                    }) : ''}
                    ${quickFilters.map((item) => this.renderDeliveryQuickFilterChip({
                        label: item.label,
                        tone: item.tone,
                        active: item.active,
                        title: item.title,
                        action: 'delivery-issue-summary-focus',
                        actionAttrs: {
                            'delivery-issue-focus-kind': item.kind,
                            'delivery-issue-focus-value': item.value
                        }
                    })).join('')}
                </div>
            </div>
        `;
        container.hidden = false;
    },

    revealPendingDeliverySection: function () {
        const target = String(this.deliveryPendingSectionReveal || '').trim().toLowerCase();
        if (!target) return;
        const targetMap = {
            tasks: 'deliveryTaskSummary',
            dead_letter: 'deliveryDeadLetterSummary',
            lock_conflicts: 'deliveryLockConflictSummary'
        };
        const element = document.getElementById(targetMap[target] || '');
        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        this.deliveryPendingSectionReveal = '';
    },

    setDeliveryWorkbenchContext: function (context = null) {
        this.deliveryWorkbenchContext = this.normalizeShopAnalyticsDrilldownContext(context);
        this.renderDeliveryTaskFilterHint();
        this.renderDeliveryIssueSummary();
    },

    clearDeliveryWorkbenchContext: function () {
        this.setDeliveryWorkbenchContext(null);
    },

    buildDeliveryActiveFilterBreadcrumbs: function () {
        const crumbs = [];
        const query = String(this.deliveryTaskQuery || '').trim();
        const bucket = this.deliveryConflictBucketFilter || null;
        const auditSelection = this.deliveryConflictAuditSelection || null;
        const taskStatus = String(this.deliveryTaskStatusFilter || 'all').trim().toLowerCase();
        const deadLetterReason = String(this.deliveryDeadLetterReasonFilter || 'all').trim().toLowerCase();
        const lockState = String(this.deliveryLockStateFilter || 'all').trim().toLowerCase();
        const auditReason = this.normalizeDeliveryConflictAuditReasonFilter(this.deliveryConflictAuditReasonFilter);
        const auditTarget = String(this.deliveryConflictAuditTargetFilter || '').trim();
        const auditChannel = String(this.deliveryConflictAuditChannelFilter || '').trim();
        const deadLetterFocusActive = this.isDeliveryConflictDeadLetterFocusActive();

        if (query) {
            const sourceMeta = this.getDeliveryTaskQuerySourceMeta();
            crumbs.push({
                key: 'query',
                label: `${sourceMeta.label}: ${this.truncateText(query, 44)}`,
                tone: sourceMeta.tone,
                preview: this.buildDeliveryFilterPreviewText(['主任务', '死信', '锁冲突', '全局占位']),
                removeAction: 'delivery-clear-task-query',
                title: '移除关键字 / 热点筛选'
            });
        }

        if (bucket?.startAt && bucket?.endAt) {
            crumbs.push({
                key: 'bucket',
                label: `冲突时段: ${this.getDeliveryConflictBucketLabel(bucket)}`,
                tone: 'warn',
                preview: this.buildDeliveryFilterPreviewText(['主任务', '死信', '锁冲突', '全局占位', '冲突审计']),
                removeAction: 'delivery-clear-conflict-bucket',
                title: '移除冲突时段联动'
            });
        }

        if (auditSelection?.auditId) {
            crumbs.push({
                key: 'audit-lock',
                label: `任务锁定: ${this.truncateText(auditSelection.taskId || auditSelection.orderId || auditSelection.auditId, 26)}`,
                tone: 'processing',
                preview: this.buildDeliveryFilterPreviewText(['主任务', '死信', '锁冲突', '全局占位', '冲突审计']),
                removeAction: 'delivery-clear-conflict-audit-selection',
                title: '移除审计记录锁定'
            });
        }

        if (deadLetterFocusActive) {
            crumbs.push({
                key: 'dead-letter-focus',
                label: '冲突死信联动',
                tone: 'danger',
                preview: this.buildDeliveryFilterPreviewText(['主任务', '死信']),
                removeAction: 'delivery-clear-conflict-dead-letter-focus',
                title: '移除冲突死信联动'
            });
        } else {
            if (taskStatus !== 'all') {
                const taskStatusMeta = this.getDeliveryTaskStatusFilterMeta(taskStatus);
                crumbs.push({
                    key: 'task-status',
                    label: `任务状态: ${taskStatusMeta.label}`,
                    tone: taskStatusMeta.tone,
                    preview: this.buildDeliveryFilterPreviewText(['主任务']),
                    removeAction: 'delivery-clear-task-status-filter',
                    title: '移除任务状态筛选'
                });
            }
            if (deadLetterReason !== 'all') {
                const deadLetterMeta = this.getDeliveryDeadLetterReasonFilterMeta(deadLetterReason);
                crumbs.push({
                    key: 'dead-letter-reason',
                    label: `死信原因: ${deadLetterMeta.label}`,
                    tone: deadLetterMeta.tone,
                    preview: this.buildDeliveryFilterPreviewText(['死信']),
                    removeAction: 'delivery-clear-dead-letter-reason-filter',
                    title: '移除死信原因筛选'
                });
            }
        }

        if (lockState !== 'all') {
            const lockStateMeta = this.getDeliveryLockStateFilterMeta(lockState);
            crumbs.push({
                key: 'lock-state',
                label: `锁视角: ${lockStateMeta.label}`,
                tone: lockStateMeta.tone,
                preview: this.buildDeliveryFilterPreviewText(['锁冲突']),
                removeAction: 'delivery-clear-lock-state-filter',
                title: '移除锁状态筛选'
            });
        }

        if (auditReason !== 'all') {
            crumbs.push({
                key: 'audit-reason',
                label: `审计原因: ${this.getDeliveryConflictAuditReasonLabel(auditReason)}`,
                tone: this.getDeliveryConflictReasonTone(auditReason),
                preview: this.buildDeliveryFilterPreviewText(['冲突审计']),
                removeAction: 'delivery-clear-conflict-audit-reason-filter',
                title: '移除冲突审计原因筛选'
            });
        }

        if (auditTarget) {
            crumbs.push({
                key: 'audit-target',
                label: `审计目标: ${this.truncateText(auditTarget, 36)}`,
                tone: 'processing',
                preview: this.buildDeliveryFilterPreviewText(['冲突审计']),
                removeAction: 'delivery-clear-conflict-audit-target-filter',
                title: '移除冲突审计目标筛选'
            });
        }

        if (auditChannel) {
            crumbs.push({
                key: 'audit-channel',
                label: `审计通道: ${this.truncateText(auditChannel, 30)}`,
                tone: 'danger',
                preview: this.buildDeliveryFilterPreviewText(['冲突审计']),
                removeAction: 'delivery-clear-conflict-audit-channel-filter',
                title: '移除冲突审计通道筛选'
            });
        }

        return crumbs;
    },

    hasDeliveryActiveFilterBreadcrumbs: function () {
        return this.buildDeliveryActiveFilterBreadcrumbs().length > 0;
    },

    isDeliveryConflictTrendLegendActive: function (kind = 'total') {
        const normalizedKind = String(kind || 'total').trim().toLowerCase();
        const reason = this.normalizeDeliveryConflictAuditReasonFilter(this.deliveryConflictAuditReasonFilter);
        if (normalizedKind === 'total') return reason === 'all';
        if (normalizedKind === 'target') {
            return ['target_conflicts', 'target_max_inflight', 'target_min_interval'].includes(reason);
        }
        if (normalizedKind === 'channel') {
            return ['channel_conflicts', 'channel_max_inflight', 'channel_min_interval'].includes(reason);
        }
        if (normalizedKind === 'manual') return reason === 'manual_force_unlock';
        if (normalizedKind === 'dead_letter') return this.isDeliveryConflictDeadLetterFocusActive();
        return false;
    },

    hasDeliveryConflictAuditFilters: function (filters = null) {
        const activeFilters = filters || {
            reason: this.deliveryConflictAuditReasonFilter,
            target_query: this.deliveryConflictAuditTargetFilter,
            channel_query: this.deliveryConflictAuditChannelFilter
        };
        return this.normalizeDeliveryConflictAuditReasonFilter(activeFilters.reason) !== 'all'
            || Boolean(String(activeFilters.target_query || '').trim())
            || Boolean(String(activeFilters.channel_query || '').trim());
    },

    getDeliveryAnalyticsWindowConfig: function (windowKey = this.deliveryAnalyticsWindow) {
        const configs = {
            '24h': {
                key: '24h',
                label: '24h',
                description: '近 24 小时',
                hours: 24,
                bucketHours: 1
            },
            '72h': {
                key: '72h',
                label: '72h',
                description: '近 72 小时',
                hours: 72,
                bucketHours: 3
            },
            '7d': {
                key: '7d',
                label: '7d',
                description: '近 7 天',
                hours: 24 * 7,
                bucketHours: 12
            }
        };
        const normalized = String(windowKey || '').trim().toLowerCase();
        return configs[normalized] || configs['24h'];
    },

    getDeliveryConflictBucketLabel: function (bucket = this.deliveryConflictBucketFilter) {
        if (!bucket?.startAt || !bucket?.endAt) return '';
        const startText = this.formatDeliveryTime(bucket.startAt);
        const endText = this.formatDeliveryTime(bucket.endAt);
        const explicitLabel = String(bucket.label || '').trim();
        if (explicitLabel) {
            return `${explicitLabel} · ${startText} - ${endText}`;
        }
        return `${startText} - ${endText}`;
    },

    resolveDeliveryAnalyticsWindowForTimestamp: function (value) {
        const timestamp = new Date(value || 0).getTime();
        if (!Number.isFinite(timestamp) || !timestamp) {
            return this.getDeliveryAnalyticsWindowConfig().key;
        }

        const ageHours = Math.max(0, (Date.now() - timestamp) / (60 * 60 * 1000));
        const candidates = ['24h', '72h', '7d'].map((key) => this.getDeliveryAnalyticsWindowConfig(key));
        return candidates.find((config) => ageHours <= Number(config.hours || 24))?.key || '7d';
    },

    buildDeliveryConflictBucketForTimestamp: function (value, windowKey = this.deliveryAnalyticsWindow) {
        const config = this.getDeliveryAnalyticsWindowConfig(windowKey);
        const bucketHours = Math.max(1, Number(config.bucketHours || 1));
        const bucketAt = new Date(value || 0);
        if (Number.isNaN(bucketAt.getTime())) return null;

        bucketAt.setMinutes(0, 0, 0);
        bucketAt.setHours(bucketAt.getHours() - (bucketAt.getHours() % bucketHours), 0, 0, 0);

        return {
            startAt: bucketAt.toISOString(),
            endAt: new Date(bucketAt.getTime() + bucketHours * 60 * 60 * 1000).toISOString(),
            label: bucketHours >= 24
                ? `${String(bucketAt.getMonth() + 1).padStart(2, '0')}-${String(bucketAt.getDate()).padStart(2, '0')}`
                : `${String(bucketAt.getMonth() + 1).padStart(2, '0')}-${String(bucketAt.getDate()).padStart(2, '0')} ${String(bucketAt.getHours()).padStart(2, '0')}:00`
        };
    },

    getDeliveryConflictAuditQueryContext: function (record = {}) {
        const scope = String(record.scope || '').trim().toLowerCase();
        const reasonKey = String(record.reason_key || '').trim().toLowerCase();
        const targetKey = String(record.target_key || record.task?.target_key || '').trim();
        const channelKey = String(record.channel_key || record.task?.channel_key || '').trim();

        if ((scope === 'channel' || reasonKey.includes('channel_')) && channelKey) {
            return { type: 'channel', query: channelKey };
        }
        if ((scope === 'target' || reasonKey.includes('target_')) && targetKey) {
            return { type: 'target', query: targetKey };
        }
        if (targetKey) {
            return { type: 'target', query: targetKey };
        }
        if (channelKey) {
            return { type: 'channel', query: channelKey };
        }

        return { type: 'manual', query: '' };
    },

    matchesDeliveryTaskIdentity: function (task = {}, identity = this.deliveryTaskIdentityFilter) {
        const taskId = String(identity?.taskId || '').trim();
        const orderId = String(identity?.orderId || '').trim();
        if (!taskId && !orderId) return false;
        if (taskId && String(task?.id || '').trim() !== taskId) return false;
        if (orderId && String(task?.order_id || '').trim() !== orderId) return false;
        return true;
    },

    revealFocusedDeliveryTaskRow: function () {
        const pending = this.deliveryPendingTaskReveal || this.deliveryTaskIdentityFilter;
        const taskId = String(pending?.taskId || '').trim();
        const orderId = String(pending?.orderId || '').trim();
        if (!taskId && !orderId) return;

        const tbody = document.getElementById('deliveryTasksTableBody');
        if (!tbody) return;

        const targetRow = Array.from(tbody.querySelectorAll('tr[data-task-id], tr[data-order-id]')).find((row) => {
            const rowTaskId = String(row.dataset.taskId || '').trim();
            const rowOrderId = String(row.dataset.orderId || '').trim();
            if (taskId && rowTaskId !== taskId) return false;
            if (orderId && rowOrderId !== orderId) return false;
            return true;
        });

        if (!targetRow) {
            this.deliveryPendingTaskReveal = null;
            return;
        }

        targetRow.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
        });
        targetRow.classList.remove('shop-delivery-task-row--reveal');
        void targetRow.offsetWidth;
        targetRow.classList.add('shop-delivery-task-row--reveal');
        window.setTimeout(() => {
            targetRow.classList.remove('shop-delivery-task-row--reveal');
        }, 2200);
        this.deliveryPendingTaskReveal = null;
    },

    findDeliveryConflictAuditForTask: function (task = {}, records = this.deliveryConflictAuditRecords || []) {
        const taskId = String(task?.id || task?.taskId || '').trim();
        const orderId = String(task?.order_id || task?.orderId || '').trim();
        if (!taskId && !orderId) return null;

        return (Array.isArray(records) ? records : []).find((record) => {
            const recordTaskId = String(record?.task_id || record?.task?.id || '').trim();
            const recordOrderId = String(record?.order_id || record?.task?.order_id || '').trim();
            if (taskId && recordTaskId === taskId) return true;
            if (orderId && recordOrderId === orderId) return true;
            return false;
        }) || null;
    },

    revealFocusedDeliveryConflictAuditRow: function () {
        const auditId = String(this.deliveryPendingAuditReveal?.auditId || this.deliveryConflictAuditSelection?.auditId || '').trim();
        if (!auditId) return;

        const tbody = document.getElementById('deliveryConflictAuditTableBody');
        if (!tbody) return;

        const targetRow = tbody.querySelector(`tr[data-audit-id="${auditId}"]`);
        if (!targetRow) {
            this.deliveryPendingAuditReveal = null;
            return;
        }

        targetRow.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
        });
        targetRow.classList.remove('shop-delivery-audit-row--reveal');
        void targetRow.offsetWidth;
        targetRow.classList.add('shop-delivery-audit-row--reveal');
        window.setTimeout(() => {
            targetRow.classList.remove('shop-delivery-audit-row--reveal');
        }, 2200);
        this.deliveryPendingAuditReveal = null;
    },

    renderDeliveryConflictAuditJumpButton: function (task = {}) {
        const record = this.findDeliveryConflictAuditForTask(task);
        if (!record) {
            return '<div class="shop-delivery-table-note">当前筛选下暂无对应冲突审计</div>';
        }

        const taskId = encodeURIComponent(String(task.id || task.taskId || ''));
        const orderId = encodeURIComponent(String(task.order_id || task.orderId || ''));
        const isActive = String(this.deliveryConflictAuditSelection?.auditId || '').trim() === String(record.id || '').trim();
        return `
            <button
                type="button"
                class="shop-delivery-action-btn${isActive ? ' shop-delivery-action-btn--linked' : ''}"
                data-shop-action="delivery-jump-audit"
                data-delivery-task-id="${this.escapeForAttr(taskId)}"
                data-delivery-order-id="${this.escapeForAttr(orderId)}"
            >
                <i class="fas fa-arrow-down"></i> ${isActive ? '回到审计' : '跳冲突审计'}
            </button>
        `;
    },

    jumpToDeliveryConflictAuditForTask: function (encodedTaskId, encodedOrderId) {
        const taskId = decodeURIComponent(String(encodedTaskId || ''));
        const orderId = decodeURIComponent(String(encodedOrderId || ''));
        const record = this.findDeliveryConflictAuditForTask({
            id: taskId,
            order_id: orderId
        });
        if (!record) return;

        const nextAuditId = String(record.id || '').trim();
        if (!nextAuditId) return;
        this.deliveryPendingAuditReveal = { auditId: nextAuditId };

        if (String(this.deliveryConflictAuditSelection?.auditId || '').trim() === nextAuditId) {
            window.requestAnimationFrame(() => this.revealFocusedDeliveryConflictAuditRow());
            return;
        }

        this.toggleDeliveryConflictAuditSelection(
            encodeURIComponent(String(record.id || '')),
            encodeURIComponent(String(record.created_at || '')),
            encodeURIComponent(String(record.task_id || record.task?.id || '')),
            encodeURIComponent(String(record.order_id || record.task?.order_id || '')),
            encodeURIComponent(String(record.target_key || record.task?.target_key || '')),
            encodeURIComponent(String(record.channel_key || record.task?.channel_key || '')),
            encodeURIComponent(String(record.reason_key || record.last_conflict_reason || '')),
            encodeURIComponent(String(record.scope || record.last_conflict_scope || ''))
        );
    },

    renderDeliveryTaskFilterHint: function () {
        const container = document.getElementById('deliveryTaskFilterHint');
        if (!container) return;

        const breadcrumbs = this.buildDeliveryActiveFilterBreadcrumbs();
        const analyticsContextMarkup = this.renderShopAnalyticsDrilldownContextMarkup(this.deliveryWorkbenchContext, {
            title: '当前履约页来自商品分析下钻',
            summary: '已按商品、关键词和问题视角联动筛到当前履约页，你可以直接处理履约、死信和异常任务。'
        });
        const restoreLinkMeta = this.getDeliveryRestoreLinkFeedbackMeta();
        const mockModeNote = this.getDeliveryMockModeNote();
        const restoreLinkButtonClass = restoreLinkMeta.tone === 'success'
            ? 'shop-delivery-inline-btn shop-delivery-inline-btn--success'
            : (restoreLinkMeta.tone === 'danger'
                ? 'shop-delivery-inline-btn shop-delivery-inline-btn--danger'
                : 'shop-delivery-inline-btn');
        if (!breadcrumbs.length) {
            container.innerHTML = `
                <div class="shop-delivery-filter-banner shop-delivery-filter-banner--idle">
                    <div class="shop-delivery-filter-stack">
                        ${analyticsContextMarkup}
                        <span class="shop-delivery-table-note">当前未联动筛选履约页。你可以输入关键字，或直接点击下方热点、趋势柱、冲突审计记录，把目标 / 通道 / 冲突时段 / 任务锁定回填到任务、死信、锁冲突和占位面板里。</span>
                        ${mockModeNote ? `<span class="shop-delivery-table-note shop-delivery-table-note--soft">${this.escapeHtml(mockModeNote)}</span>` : ''}
                        <span class="shop-delivery-table-note shop-delivery-table-note--soft">${this.escapeHtml(restoreLinkMeta.note)}</span>
                    </div>
                    <div class="shop-delivery-controls shop-delivery-controls--banner">
                        <button type="button" class="${restoreLinkButtonClass}" data-shop-action="delivery-copy-restore-link">
                            <i class="fas ${this.escapeHtml(restoreLinkMeta.icon)}"></i> ${this.escapeHtml(restoreLinkMeta.label)}
                        </button>
                    </div>
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <div class="shop-delivery-filter-banner">
                <div class="shop-delivery-filter-stack">
                    ${analyticsContextMarkup}
                    <span class="shop-delivery-table-note">当前已生效筛选已同步到对应面板。悬停面包屑可预览影响范围，点击任一项可单独移除。</span>
                    <div class="shop-delivery-filter-crumbs">
                        ${breadcrumbs.map((crumb) => this.renderDeliveryFilterBreadcrumb(crumb)).join('')}
                    </div>
                    ${mockModeNote ? `<span class="shop-delivery-table-note shop-delivery-table-note--soft">${this.escapeHtml(mockModeNote)}</span>` : ''}
                    <span class="shop-delivery-table-note shop-delivery-table-note--soft">${this.escapeHtml(restoreLinkMeta.note)}</span>
                </div>
                <div class="shop-delivery-controls shop-delivery-controls--banner">
                    <button type="button" class="${restoreLinkButtonClass}" data-shop-action="delivery-copy-restore-link">
                        <i class="fas ${this.escapeHtml(restoreLinkMeta.icon)}"></i> ${this.escapeHtml(restoreLinkMeta.label)}
                    </button>
                    <button type="button" class="shop-delivery-inline-btn" data-shop-action="delivery-clear-all-filter-breadcrumbs">
                        <i class="fas fa-broom"></i> 清空全部
                    </button>
                </div>
            </div>
        `;
    },

    parseDeliveryStrategyInteger: function (value, fallback) {
        const parsed = Number.parseInt(value, 10);
        return Number.isFinite(parsed) ? parsed : fallback;
    },

    renderDeliveryStrategy: function (config = {}) {
        this.deliveryStrategyConfig = config || {};

        const summary = document.getElementById('deliveryStrategySummary');
        const fields = {
            deliveryStrategyMaxAttempts: Number(config.max_attempts || 5),
            deliveryStrategySweepInterval: Number(config.sweep_interval_ms || 10000),
            deliveryStrategySweepBatch: Number(config.sweep_batch_size || 10),
            deliveryStrategyWorkerParallelism: Number(config.worker_parallelism || 1),
            deliveryStrategyLeaseSeconds: Number(config.lease_seconds || 120),
            deliveryStrategyHttpTimeout: Number(config.http_timeout_ms || 15000),
            deliveryStrategyBaseBackoff: Number(config.base_backoff_seconds || 30),
            deliveryStrategyMaxBackoff: Number(config.max_backoff_seconds || 1800),
            deliveryStrategyTargetMinInterval: Number(config.target_min_interval_ms || 0),
            deliveryStrategyTargetMaxInflight: Number(config.target_max_inflight || 1),
            deliveryStrategyChannelMinInterval: Number(config.channel_min_interval_ms || 0),
            deliveryStrategyChannelMaxInflight: Number(config.channel_max_inflight || 2),
            deliveryStrategyConflictBackoff: Number(config.conflict_backoff_seconds || 45),
            deliveryStrategyConflictThreshold: Number(config.conflict_dead_letter_threshold || 0)
        };

        Object.entries(fields).forEach(([elementId, value]) => {
            const input = document.getElementById(elementId);
            if (input) {
                input.value = String(value);
            }
        });

        const applyToOpenTasks = document.getElementById('deliveryStrategyApplyOpenTasks');
        if (applyToOpenTasks && typeof applyToOpenTasks.checked === 'boolean') {
            applyToOpenTasks.checked = true;
        }

        if (!summary) return;

        summary.classList.add('shop-delivery-subcard-meta--rich');
        summary.innerHTML = [
            this.renderDeliveryMetaBadge(`最大重试 ${fields.deliveryStrategyMaxAttempts}`, 'warn'),
            this.renderDeliveryMetaBadge(`扫描 ${fields.deliveryStrategySweepInterval}ms`, 'processing'),
            this.renderDeliveryMetaBadge(`批次 ${fields.deliveryStrategySweepBatch}`, 'processing'),
            this.renderDeliveryMetaBadge(`并发 ${fields.deliveryStrategyWorkerParallelism}`, 'processing'),
            this.renderDeliveryMetaBadge(`租约 ${fields.deliveryStrategyLeaseSeconds}s`, 'neutral'),
            this.renderDeliveryMetaBadge(`超时 ${fields.deliveryStrategyHttpTimeout}ms`, 'neutral'),
            this.renderDeliveryMetaBadge(`退避 ${fields.deliveryStrategyBaseBackoff}-${fields.deliveryStrategyMaxBackoff}s`, 'muted'),
            this.renderDeliveryMetaBadge(`目标 ${fields.deliveryStrategyTargetMinInterval}ms / ${fields.deliveryStrategyTargetMaxInflight} 并发`, 'warn'),
            this.renderDeliveryMetaBadge(`通道 ${fields.deliveryStrategyChannelMinInterval}ms / ${fields.deliveryStrategyChannelMaxInflight} 并发`, 'warn'),
            this.renderDeliveryMetaBadge(`冲突回退 ${fields.deliveryStrategyConflictBackoff}s`, 'danger'),
            this.renderDeliveryMetaBadge(`冲突死信阈值 ${fields.deliveryStrategyConflictThreshold || '关闭'}`, fields.deliveryStrategyConflictThreshold ? 'danger' : 'muted')
        ].join('');
    },

    renderDeliveryStrategyError: function (message) {
        const summary = document.getElementById('deliveryStrategySummary');
        if (!summary) return;
        summary.classList.add('shop-delivery-subcard-meta--rich');
        summary.innerHTML = this.renderDeliveryMetaBadge(message || '策略加载失败', 'danger');
    },

    getDeliveryStrategyPayload: function () {
        const current = this.deliveryStrategyConfig || {};
        return {
            max_attempts: this.parseDeliveryStrategyInteger(document.getElementById('deliveryStrategyMaxAttempts')?.value, Number(current.max_attempts || 5)),
            sweep_interval_ms: this.parseDeliveryStrategyInteger(document.getElementById('deliveryStrategySweepInterval')?.value, Number(current.sweep_interval_ms || 10000)),
            sweep_batch_size: this.parseDeliveryStrategyInteger(document.getElementById('deliveryStrategySweepBatch')?.value, Number(current.sweep_batch_size || 10)),
            worker_parallelism: this.parseDeliveryStrategyInteger(document.getElementById('deliveryStrategyWorkerParallelism')?.value, Number(current.worker_parallelism || 1)),
            lease_seconds: this.parseDeliveryStrategyInteger(document.getElementById('deliveryStrategyLeaseSeconds')?.value, Number(current.lease_seconds || 120)),
            http_timeout_ms: this.parseDeliveryStrategyInteger(document.getElementById('deliveryStrategyHttpTimeout')?.value, Number(current.http_timeout_ms || 15000)),
            base_backoff_seconds: this.parseDeliveryStrategyInteger(document.getElementById('deliveryStrategyBaseBackoff')?.value, Number(current.base_backoff_seconds || 30)),
            max_backoff_seconds: this.parseDeliveryStrategyInteger(document.getElementById('deliveryStrategyMaxBackoff')?.value, Number(current.max_backoff_seconds || 1800)),
            target_min_interval_ms: this.parseDeliveryStrategyInteger(document.getElementById('deliveryStrategyTargetMinInterval')?.value, Number(current.target_min_interval_ms || 0)),
            target_max_inflight: this.parseDeliveryStrategyInteger(document.getElementById('deliveryStrategyTargetMaxInflight')?.value, Number(current.target_max_inflight || 1)),
            channel_min_interval_ms: this.parseDeliveryStrategyInteger(document.getElementById('deliveryStrategyChannelMinInterval')?.value, Number(current.channel_min_interval_ms || 0)),
            channel_max_inflight: this.parseDeliveryStrategyInteger(document.getElementById('deliveryStrategyChannelMaxInflight')?.value, Number(current.channel_max_inflight || 2)),
            conflict_backoff_seconds: this.parseDeliveryStrategyInteger(document.getElementById('deliveryStrategyConflictBackoff')?.value, Number(current.conflict_backoff_seconds || 45)),
            conflict_dead_letter_threshold: this.parseDeliveryStrategyInteger(document.getElementById('deliveryStrategyConflictThreshold')?.value, Number(current.conflict_dead_letter_threshold || 0))
        };
    },

    getOrderDeliveryStatusBadge: function (order) {
        const refundStatus = String(order?.refund_status || '').toLowerCase();
        if (refundStatus === 'refunded' || refundStatus === 'full_refund') {
            return this.renderDeliveryBadge('已退款', 'muted');
        }

        const status = String(order?.delivery_status || '').toLowerCase();
        switch (status) {
            case 'delivered':
                return this.renderDeliveryBadge('已履约', 'success');
            case 'processing':
                return this.renderDeliveryBadge('履约中', 'processing');
            case 'retry_waiting':
                return this.renderDeliveryBadge('待重试', 'waiting');
            case 'requeued':
                return this.renderDeliveryBadge('已重排队', 'processing');
            case 'dead_letter':
                return this.renderDeliveryBadge('死信', 'danger');
            case 'pending':
                return this.renderDeliveryBadge('待履约', 'waiting');
            default:
                return this.renderDeliveryBadge('已完成', 'neutral');
        }
    },

    getDeliveryTaskStatusBadge: function (status) {
        switch (String(status || '').toLowerCase()) {
            case 'pending':
                return this.renderDeliveryBadge('待履约', 'waiting');
            case 'processing':
                return this.renderDeliveryBadge('处理中', 'processing');
            case 'retry_waiting':
                return this.renderDeliveryBadge('待重试', 'waiting');
            case 'requeued':
                return this.renderDeliveryBadge('已重排队', 'processing');
            case 'dead_letter':
                return this.renderDeliveryBadge('死信', 'danger');
            case 'delivered':
                return this.renderDeliveryBadge('已履约', 'success');
            default:
                return this.renderDeliveryBadge(status || '未知', 'neutral');
        }
    },

    formatDeliveryTime: function (value) {
        if (!value) return '—';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '—';
        return date.toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    },

    formatDeliveryDuration: function (valueMs) {
        const durationMs = Number(valueMs || 0);
        if (!Number.isFinite(durationMs) || durationMs <= 0) return '—';

        const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
        if (totalSeconds < 60) return `${totalSeconds}s`;

        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        if (minutes < 60) {
            return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
        }

        const hours = Math.floor(minutes / 60);
        const remainingMinutes = minutes % 60;
        if (hours < 24) {
            return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
        }

        const days = Math.floor(hours / 24);
        const remainingHours = hours % 24;
        return remainingHours ? `${days}d ${remainingHours}h` : `${days}d`;
    },

    formatDeliveryAge: function (value) {
        if (!value) return '—';
        const timestamp = new Date(value).getTime();
        if (!Number.isFinite(timestamp) || !timestamp) return '—';
        return this.formatDeliveryDuration(Date.now() - timestamp);
    },

    truncateText: function (value, maxLength = 88) {
        const text = String(value || '');
        if (text.length <= maxLength) return text;
        return `${text.slice(0, maxLength - 1)}…`;
    },

    formatDeliveryTaskTarget: function (value) {
        if (!value) return '—';
        try {
            const parsed = new URL(value);
            const display = `${parsed.hostname}${parsed.pathname === '/' ? '' : parsed.pathname}`;
            return this.escapeHtml(this.truncateText(display, 40));
        } catch (_) {
            return this.escapeHtml(this.truncateText(value, 40));
        }
    },

    renderDeliveryTaskSummary: function (summary = {}) {
        const container = document.getElementById('deliveryTaskSummary');
        if (!container) return;
        const recentConflictsLabel = summary.recent_conflicts_label || `${this.getDeliveryAnalyticsWindowConfig().label} 冲突`;

        const items = [
            { label: '全部任务', value: summary.total || 0, tone: 'neutral' },
            { label: '待执行', value: summary.retryable || 0, tone: 'waiting' },
            { label: '处理中', value: summary.processing || 0, tone: 'processing' },
            { label: '死信', value: summary.dead_letter || 0, tone: 'danger' },
            { label: '已履约', value: summary.delivered || 0, tone: 'success' },
            { label: '冲突任务', value: summary.conflict_tasks || 0, tone: 'warn' },
            { label: recentConflictsLabel, value: summary.recent_conflicts || 0, tone: 'warn' },
            { label: '全局占位', value: summary.reservation_active || 0, tone: 'processing' },
            { label: '占位漂移', value: summary.reservation_drift || 0, tone: 'danger' },
            { label: '占位目标', value: summary.reservation_targets || 0, tone: 'neutral' },
            { label: '占位通道', value: summary.reservation_channels || 0, tone: 'neutral' },
            { label: '活跃锁', value: summary.locked_active || 0, tone: 'processing' },
            { label: '过期锁', value: summary.locked_stale || 0, tone: 'danger' },
            { label: '缺锁', value: summary.lock_missing || 0, tone: 'danger' },
            { label: '待解锁', value: summary.force_unlock_candidates || 0, tone: 'waiting' },
            { label: '人工重放', value: summary.manual_replays || 0, tone: 'muted' }
        ];

        container.innerHTML = items.map((item) => {
            const toneClass = item.tone === 'danger'
                ? 'shop-delivery-pill shop-delivery-pill--danger'
                : item.tone === 'waiting' || item.tone === 'warn'
                    ? 'shop-delivery-pill shop-delivery-pill--warn'
                    : 'shop-delivery-pill';
            return `<span class="${toneClass}"><strong>${item.value}</strong><span>${item.label}</span></span>`;
        }).join('');
    },

    shortenDeliveryToken: function (value, head = 6, tail = 4) {
        const text = String(value || '').trim();
        if (!text) return '';
        if (text.length <= head + tail + 1) return text;
        return `${text.slice(0, head)}…${text.slice(-tail)}`;
    },

    getDeliveryLockBadge: function (task = {}) {
        const state = String(task?.lock_state || '').toLowerCase();

        if (state === 'lock_missing') {
            return this.renderDeliveryBadge('缺锁', 'danger');
        }
        if (state === 'locked_unknown') {
            return this.renderDeliveryBadge('未知锁', 'muted');
        }
        if (state === 'locked_active') {
            return this.renderDeliveryBadge('活跃锁', 'processing');
        }
        if (state === 'locked_stale') {
            return this.renderDeliveryBadge('过期锁', 'danger');
        }

        if (!task?.lock_token) return '';
        const expiresAt = task.lock_expires_at ? new Date(task.lock_expires_at).getTime() : 0;
        const isActive = Number.isFinite(expiresAt) && expiresAt > Date.now();
        return this.renderDeliveryBadge(isActive ? '活跃锁' : '过期锁', isActive ? 'processing' : 'danger');
    },

    getDeliveryReservationBadge: function (task = {}) {
        const state = String(task?.reservation_state?.key || '').toLowerCase();

        if (state === 'active') {
            return this.renderDeliveryBadge('全局占位生效', 'processing');
        }
        if (state === 'token_drift') {
            return this.renderDeliveryBadge('Token 漂移', 'danger');
        }
        if (state === 'worker_drift') {
            return this.renderDeliveryBadge('Worker 漂移', 'danger');
        }
        if (state === 'missing_lock') {
            return this.renderDeliveryBadge('占位缺锁', 'danger');
        }
        if (state === 'stale_lock') {
            return this.renderDeliveryBadge('占位过期', 'danger');
        }
        if (state === 'released_pending_cleanup') {
            return this.renderDeliveryBadge('占位残留', 'warn');
        }
        if (state === 'incomplete') {
            return this.renderDeliveryBadge('占位不完整', 'warn');
        }

        return '';
    },

    getDeliveryConflictBadge: function (record = {}) {
        const reason = record?.conflict_reason || {};
        const key = String(reason.key || record?.last_conflict_reason || '').toLowerCase();
        const label = reason.label || (
            key.includes('target_max_inflight')
                ? '目标并发打满'
                : key.includes('target_min_interval')
                    ? '目标限流'
                    : key.includes('channel_max_inflight')
                        ? '通道并发打满'
                        : key.includes('channel_min_interval')
                            ? '通道限流'
                            : key.includes('manual_force_unlock')
                                ? '人工强制解锁'
                                : ''
        );
        if (!label) return '';

        const tone = reason.tone || (
            key.includes('channel_max_inflight') ? 'danger'
                : key.includes('manual_force_unlock') ? 'processing'
                    : 'waiting'
        );
        return this.renderDeliveryBadge(label, tone);
    },

    renderDeliveryObserveChips: function (task = {}) {
        const chips = [];
        const lockBadge = this.getDeliveryLockBadge(task);
        const reservationBadge = this.getDeliveryReservationBadge(task);
        const conflictBadge = this.getDeliveryConflictBadge(task);

        if (reservationBadge) chips.push(reservationBadge);
        if (lockBadge) chips.push(lockBadge);
        if (conflictBadge) chips.push(conflictBadge);
        if (task.reservation_acquired_at) {
            chips.push(`<span class="shop-delivery-meta-chip">占位于 ${this.formatDeliveryTime(task.reservation_acquired_at)}</span>`);
        }
        if (task.reservation_lock_token && task.reservation_lock_token !== task.lock_token) {
            const reservationToken = this.escapeHtml(this.shortenDeliveryToken(task.reservation_lock_token, 8, 6));
            chips.push(`<span class="shop-delivery-meta-chip" title="${this.escapeHtml(task.reservation_lock_token)}">占位锁 ${reservationToken}</span>`);
        }
        if (task.reservation_worker_name && task.reservation_worker_name !== task.worker_name) {
            chips.push(`<span class="shop-delivery-meta-chip">占位 Worker ${this.escapeHtml(task.reservation_worker_name)}</span>`);
        }
        if (task.dedupe_key) {
            const dedupe = this.escapeHtml(this.shortenDeliveryToken(task.dedupe_key, 10, 6));
            chips.push(`<span class="shop-delivery-meta-chip" title="${this.escapeHtml(task.dedupe_key)}">幂等 ${dedupe}</span>`);
        }
        if (task.target_key) {
            chips.push(`<span class="shop-delivery-meta-chip" title="${this.escapeHtml(task.target_key)}">目标 ${this.escapeHtml(this.truncateText(task.target_key, 28))}</span>`);
        }
        if (task.channel_key) {
            chips.push(`<span class="shop-delivery-meta-chip">通道 ${this.escapeHtml(this.truncateText(task.channel_key, 24))}</span>`);
        }
        if (task.lock_token) {
            const lockToken = this.escapeHtml(this.shortenDeliveryToken(task.lock_token, 8, 6));
            chips.push(`<span class="shop-delivery-meta-chip" title="${this.escapeHtml(task.lock_token)}">锁 ${lockToken}</span>`);
        }
        if (task.worker_name) {
            chips.push(`<span class="shop-delivery-meta-chip">Worker ${this.escapeHtml(task.worker_name)}</span>`);
        }
        if (Number(task.manual_replay_count || 0) > 0) {
            chips.push(`<span class="shop-delivery-meta-chip">人工重放 ${Number(task.manual_replay_count)}</span>`);
        }
        if (task.manual_replay_requested_at) {
            chips.push(`<span class="shop-delivery-meta-chip">重放申请 ${this.formatDeliveryTime(task.manual_replay_requested_at)}</span>`);
        }
        if (Number(task.conflict_count || 0) > 0) {
            chips.push(`<span class="shop-delivery-meta-chip">冲突 ${Number(task.conflict_count)}</span>`);
        }
        if (task.last_conflict_at) {
            chips.push(`<span class="shop-delivery-meta-chip">最近冲突 ${this.formatDeliveryTime(task.last_conflict_at)}</span>`);
        }

        if (!chips.length) {
            return '<div class="shop-delivery-table-note">无额外观测字段</div>';
        }

        return `<div class="shop-delivery-observe-stack">${chips.join('')}</div>`;
    },

    renderDeliveryCompactObserveChips: function (record = {}) {
        const chips = [];
        const reservationBadge = this.getDeliveryReservationBadge(record);
        if (reservationBadge) {
            chips.push(reservationBadge);
        }
        if (record.lock_state === 'locked_active') {
            chips.push(this.renderDeliveryMetaBadge('活跃锁', 'processing'));
        } else if (record.lock_state === 'locked_stale') {
            chips.push(this.renderDeliveryMetaBadge('过期锁', 'danger'));
        } else if (record.lock_state === 'lock_missing') {
            chips.push(this.renderDeliveryMetaBadge('缺锁', 'danger'));
        } else if (record.lock_state === 'locked_unknown') {
            chips.push(this.renderDeliveryMetaBadge('未知锁', 'muted'));
        }
        if (record.worker_name) {
            chips.push(this.renderDeliveryMetaBadge(`Worker ${record.worker_name}`, 'muted'));
        }
        if (record.target_key) {
            chips.push(this.renderDeliveryMetaBadge(`目标 ${this.shortenDeliveryToken(record.target_key, 10, 6)}`, 'muted'));
        }
        if (record.channel_key) {
            chips.push(this.renderDeliveryMetaBadge(`通道 ${this.shortenDeliveryToken(record.channel_key, 8, 5)}`, 'muted'));
        }
        if (record.dedupe_key) {
            chips.push(this.renderDeliveryMetaBadge(`幂等 ${this.shortenDeliveryToken(record.dedupe_key, 8, 5)}`, 'muted'));
        }
        if (record.reservation_acquired_at) {
            chips.push(this.renderDeliveryMetaBadge(`占位 ${this.formatDeliveryAge(record.reservation_acquired_at)}`, 'muted'));
        }
        if (Number(record.conflict_count || 0) > 0) {
            chips.push(this.renderDeliveryMetaBadge(`冲突 ${Number(record.conflict_count)}`, 'warn'));
        }
        return chips.length
            ? `<div class="shop-delivery-meta">${chips.join('')}</div>`
            : '<div class="shop-delivery-table-note">无额外观测字段</div>';
    },

    renderDeliveryAttemptLines: function (task = {}) {
        const attempts = Array.isArray(task.attempts) ? task.attempts.slice(0, 3) : [];
        if (!attempts.length) {
            return '<div class="shop-delivery-table-note">暂无尝试记录</div>';
        }

        return `
            <div class="shop-delivery-attempt-stack">
                ${attempts.map((attempt) => {
                    const success = Boolean(attempt?.success);
                    const tone = success ? 'success' : 'danger';
                    const statusLabel = success ? '成功' : '失败';
                    const durationText = Number.isFinite(Number(attempt?.duration_ms))
                        ? `${Math.round(Number(attempt.duration_ms))}ms`
                        : '—';
                    const worker = this.escapeHtml(attempt?.worker_name || 'worker');
                    const time = this.formatDeliveryTime(attempt?.started_at || attempt?.finished_at);
                    const errorText = attempt?.error_message
                        ? ` · ${this.escapeHtml(this.truncateText(attempt.error_message, 44))}`
                        : '';

                    return `
                        <div class="shop-delivery-attempt-line">
                            <strong>#${Number(attempt?.attempt_no || 0)}</strong>
                            ${this.renderDeliveryBadge(statusLabel, tone)}
                            <span>${worker}</span>
                            <span>${time}</span>
                            <span>${durationText}</span>${errorText}
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    },

    renderDeliveryActionButtons: function (task = {}, options = {}) {
        const allowDeadLetter = options.allowDeadLetter !== false;
        const allowForceUnlock = options.allowForceUnlock !== false;
        const actions = [];
        const lockState = String(task.lock_state || '').toLowerCase();
        const canForceUnlock = allowForceUnlock && (
            task.status === 'processing'
            || lockState === 'locked_stale'
            || lockState === 'lock_missing'
            || lockState === 'locked_unknown'
        );
        const encodedTaskId = this.escapeForAttr(String(task.id || ''));

        if (task.status !== 'delivered') {
            actions.push(`<button class="shop-delivery-action-btn" data-shop-action="delivery-task-action" data-delivery-task-id="${encodedTaskId}" data-delivery-task-command="requeue">重排队</button>`);
            actions.push(`<button class="shop-delivery-action-btn" data-shop-action="delivery-task-action" data-delivery-task-id="${encodedTaskId}" data-delivery-task-command="replay">人工重放</button>`);
            actions.push(`<button class="shop-delivery-action-btn" data-shop-action="delivery-task-action" data-delivery-task-id="${encodedTaskId}" data-delivery-task-command="mark_delivered">标已履约</button>`);
        }
        if (canForceUnlock) {
            actions.push(`<button class="shop-delivery-action-btn" data-shop-action="delivery-task-action" data-delivery-task-id="${encodedTaskId}" data-delivery-task-command="force_unlock">强制解锁</button>`);
        }
        if (allowDeadLetter && task.status !== 'dead_letter') {
            actions.push(`<button class="shop-delivery-action-btn danger" data-shop-action="delivery-task-action" data-delivery-task-id="${encodedTaskId}" data-delivery-task-command="mark_dead_letter">标死信</button>`);
        }

        return actions.length
            ? `<div class="shop-delivery-task-actions">${actions.join('')}</div>`
            : '<div class="shop-delivery-table-note">暂无可执行动作</div>';
    },

    renderDeliveryTasks: function (tasks = [], total = 0, page = 1, pageSize = this.deliveryTaskPageSize) {
        const tbody = document.getElementById('deliveryTasksTableBody');
        if (!tbody) return;

        if (!tasks.length) {
            tbody.innerHTML = `<tr><td colspan="8"><div class="shop-delivery-empty">当前筛选条件下暂无 API 履约任务。</div></td></tr>`;
            this.renderPagination('deliveryTasksPagination', page, total, pageSize, 'loadDeliveryTasks');
            return;
        }

        tbody.innerHTML = tasks.map((task) => {
            const order = task.order || {};
            const isFocused = this.matchesDeliveryTaskIdentity(task);
            const productName = this.escapeHtml(order.snapshot_product_name || '—');
            const latestError = task.last_error
                ? `<span title="${this.escapeHtml(task.last_error)}">${this.escapeHtml(this.truncateText(task.last_error, 68))}</span>`
                : '<span class="shop-delivery-placeholder">—</span>';
            const executeTimeline = `
                <div class="shop-delivery-attempt-stack">
                    <div class="shop-delivery-attempt-line"><strong>上次</strong> <span>${this.formatDeliveryTime(task.last_attempt_at || task.updated_at || task.created_at)}</span></div>
                    <div class="shop-delivery-attempt-line"><strong>下次</strong> <span>${this.formatDeliveryTime(task.next_attempt_at)}</span></div>
                </div>
            `;
            const taskBadges = [
                this.getDeliveryTaskStatusBadge(task.status),
                order.delivery_status ? this.getOrderDeliveryStatusBadge(order) : ''
            ].filter(Boolean).join('');

            return `
                <tr
                    class="${isFocused ? 'shop-delivery-task-row--focused' : ''}"
                    data-task-id="${this.escapeHtml(task.id || '')}"
                    data-order-id="${this.escapeHtml(task.order_id || '')}"
                >
                    <td data-label="订单号">
                        <div class="shop-delivery-value">${this.escapeHtml(task.order_id || '—')}</div>
                        <div class="shop-delivery-table-note">${task.dedupe_key ? this.escapeHtml(this.truncateText(task.dedupe_key, 36)) : '无去重键'}</div>
                    </td>
                    <td data-label="商品">
                        <div class="shop-delivery-value">${productName}</div>
                        <div class="shop-delivery-table-note">${this.escapeHtml(order.user_id || '未知用户')}</div>
                    </td>
                    <td data-label="任务状态">
                        <div class="shop-delivery-meta shop-delivery-meta--stacked">${taskBadges}</div>
                        ${this.renderDeliveryObserveChips(task)}
                    </td>
                    <td data-label="尝试次数">
                        <div class="shop-delivery-value shop-delivery-value--strong shop-delivery-value--spaced">${Number(task.attempt_count || 0)} / ${Number(task.max_attempts || 0)}</div>
                        ${this.renderDeliveryAttemptLines(task)}
                    </td>
                    <td data-label="目标地址">
                        <div class="shop-delivery-target" title="${this.escapeHtml(task.target_url || '')}">${this.formatDeliveryTaskTarget(task.target_url)}</div>
                    </td>
                    <td data-label="最近执行 / 下次重试" class="shop-delivery-table-cell--timeline">${executeTimeline}</td>
                    <td data-label="最近错误" class="shop-delivery-table-cell--relaxed">
                        ${latestError}
                    </td>
                    <td data-label="操作">${this.renderDeliveryActionButtons(task)}</td>
                </tr>
            `;
        }).join('');

        this.renderPagination('deliveryTasksPagination', page, total, pageSize, 'loadDeliveryTasks');
    },

    renderDeliveryDeadLetterSummary: function (data = {}) {
        const meta = document.getElementById('deliveryDeadLetterSummary');
        if (!meta) return;
        const summary = data.summary || {};
        const total = Number(data.total || summary.total || 0);
        const pills = [
            this.renderDeliveryMetaBadge(`共 ${total} 条`, total ? 'danger' : 'muted'),
            this.renderDeliveryMetaBadge(`目标缺失 ${Number(summary.missing_target || 0)}`, Number(summary.missing_target || 0) ? 'danger' : 'muted'),
            this.renderDeliveryMetaBadge(`超时 ${Number(summary.timeout || 0)}`, Number(summary.timeout || 0) ? 'warn' : 'muted'),
            this.renderDeliveryMetaBadge(`4xx ${Number(summary.upstream_4xx || 0)}`, Number(summary.upstream_4xx || 0) ? 'danger' : 'muted'),
            this.renderDeliveryMetaBadge(`5xx ${Number(summary.upstream_5xx || 0)}`, Number(summary.upstream_5xx || 0) ? 'danger' : 'muted'),
            this.renderDeliveryMetaBadge(`最大重试 ${Number(summary.max_attempts || 0)}`, Number(summary.max_attempts || 0) ? 'warn' : 'muted'),
            this.renderDeliveryMetaBadge(`冲突策略 ${Number(summary.conflict_strategy || 0)}`, Number(summary.conflict_strategy || 0) ? 'warn' : 'muted'),
            this.renderDeliveryMetaBadge(`人工标记 ${Number(summary.manual || 0)}`, Number(summary.manual || 0) ? 'processing' : 'muted')
        ];
        meta.classList.add('shop-delivery-subcard-meta--rich');
        meta.innerHTML = total ? pills.join('') : '<span class="shop-delivery-table-note">当前无死信</span>';
    },

    renderLockConflictSummary: function (data = {}) {
        const meta = document.getElementById('deliveryLockConflictSummary');
        if (!meta) return;

        const summary = data.summary || {};
        const total = Number(data.total || summary.total || 0);
        const filterMap = {
            all: '全部锁异常',
            active: '仅活跃锁',
            stale: '过期 / 缺锁'
        };
        const currentFilter = filterMap[data.lockState || this.deliveryLockStateFilter || 'all'] || '全部锁异常';
        const pills = [
            this.renderDeliveryMetaBadge(`共 ${total} 条`, total ? 'danger' : 'muted'),
            this.renderDeliveryMetaBadge(`活跃 ${Number(summary.active || 0)}`, Number(summary.active || 0) ? 'processing' : 'muted'),
            this.renderDeliveryMetaBadge(`过期 ${Number(summary.stale || 0)}`, Number(summary.stale || 0) ? 'danger' : 'muted'),
            this.renderDeliveryMetaBadge(`缺锁 ${Number(summary.missing || 0)}`, Number(summary.missing || 0) ? 'danger' : 'muted'),
            this.renderDeliveryMetaBadge(`人工重放待处理 ${Number(summary.manual_replay_requested || 0)}`, Number(summary.manual_replay_requested || 0) ? 'warn' : 'muted'),
            this.renderDeliveryMetaBadge(`待解锁 ${Number(summary.force_unlock_candidates || 0)}`, Number(summary.force_unlock_candidates || 0) ? 'warn' : 'muted'),
            this.renderDeliveryMetaBadge(currentFilter, 'neutral')
        ];

        meta.classList.add('shop-delivery-subcard-meta--rich');
        meta.innerHTML = total ? pills.join('') : '<span class="shop-delivery-table-note">当前没有锁冲突</span>';
    },

    renderReplaySummary: function (data = {}) {
        const meta = document.getElementById('deliveryReplaySummary');
        if (!meta) return;
        const summary = data.summary || {};
        const total = Number(data.total || summary.total || 0);
        const latestReplay = summary.latest_replay_at ? this.formatDeliveryTime(summary.latest_replay_at) : '—';
        const pills = [
            this.renderDeliveryMetaBadge(`共 ${total} 条`, total ? 'processing' : 'muted'),
            this.renderDeliveryMetaBadge(`管理员 ${Number(summary.admin_count || 0)}`, Number(summary.admin_count || 0) ? 'processing' : 'muted'),
            this.renderDeliveryMetaBadge(`待继续 ${Number(summary.pending || 0) + Number(summary.retry_waiting || 0)}`, (Number(summary.pending || 0) + Number(summary.retry_waiting || 0)) ? 'warn' : 'muted'),
            this.renderDeliveryMetaBadge(`已履约 ${Number(summary.delivered || 0)}`, Number(summary.delivered || 0) ? 'success' : 'muted'),
            this.renderDeliveryMetaBadge(`最新 ${latestReplay}`, summary.latest_replay_at ? 'neutral' : 'muted')
        ];
        meta.classList.add('shop-delivery-subcard-meta--rich');
        meta.innerHTML = total ? pills.join('') : '<span class="shop-delivery-table-note">暂无人工重放</span>';
    },

    renderConflictAuditSummary: function (data = {}) {
        const meta = document.getElementById('deliveryConflictAuditSummary');
        if (!meta) return;
        const summary = data.summary || {};
        const total = Number(data.total || summary.total || 0);
        const sourceTotal = Number(data.sourceTotal || total || 0);
        const filters = {
            reason: this.normalizeDeliveryConflictAuditReasonFilter(data.filters?.reason || this.deliveryConflictAuditReasonFilter),
            target_query: String(data.filters?.target_query || this.deliveryConflictAuditTargetFilter || '').trim(),
            channel_query: String(data.filters?.channel_query || this.deliveryConflictAuditChannelFilter || '').trim()
        };
        const hasAuditFilters = this.hasDeliveryConflictAuditFilters(filters);
        const latestConflict = summary.latest_conflict_at ? this.formatDeliveryTime(summary.latest_conflict_at) : '—';
        const auditSelection = this.deliveryConflictAuditSelection || null;
        const activeReason = this.normalizeDeliveryConflictAuditReasonFilter(filters.reason);
        const deadLetterFocusActive = this.isDeliveryConflictDeadLetterFocusActive();
        const unknownConflictCount = Math.max(
            0,
            total
                - Number(summary.target_max_inflight || 0)
                - Number(summary.target_min_interval || 0)
                - Number(summary.channel_max_inflight || 0)
                - Number(summary.channel_min_interval || 0)
                - Number(summary.manual_force_unlock || 0)
        );
        const pills = [
            hasAuditFilters
                ? this.renderDeliveryQuickFilterChip({
                    label: sourceTotal ? `命中 ${total} / ${sourceTotal}` : `命中 ${total} 条`,
                    tone: total ? 'warn' : 'muted',
                    active: true,
                    title: '点击清除冲突审计二次过滤',
                    action: 'delivery-clear-conflict-audit-filters'
                })
                : this.renderDeliveryMetaBadge(`最近 ${total} 条`, total ? 'warn' : 'muted'),
            this.renderConflictAuditSummaryReasonBadge({
                reasonKey: 'target_max_inflight',
                label: '目标并发',
                count: summary.target_max_inflight,
                tone: 'warn',
                active: activeReason === 'target_max_inflight'
            }),
            this.renderConflictAuditSummaryReasonBadge({
                reasonKey: 'target_min_interval',
                label: '目标限流',
                count: summary.target_min_interval,
                tone: 'warn',
                active: activeReason === 'target_min_interval'
            }),
            this.renderConflictAuditSummaryReasonBadge({
                reasonKey: 'channel_max_inflight',
                label: '通道并发',
                count: summary.channel_max_inflight,
                tone: 'danger',
                active: activeReason === 'channel_max_inflight'
            }),
            this.renderConflictAuditSummaryReasonBadge({
                reasonKey: 'channel_min_interval',
                label: '通道限流',
                count: summary.channel_min_interval,
                tone: 'warn',
                active: activeReason === 'channel_min_interval'
            }),
            this.renderConflictAuditSummaryReasonBadge({
                reasonKey: 'manual_force_unlock',
                label: '人工解锁',
                count: summary.manual_force_unlock,
                tone: 'processing',
                active: activeReason === 'manual_force_unlock'
            }),
            this.renderConflictAuditSummaryReasonBadge({
                reasonKey: 'unknown_conflict',
                label: '其他冲突',
                count: unknownConflictCount,
                tone: 'muted',
                active: activeReason === 'unknown_conflict'
            }),
            (Number(summary.dead_letter || 0) || deadLetterFocusActive)
                ? this.renderDeliveryQuickFilterChip({
                    label: `冲突死信 ${Number(summary.dead_letter || 0)}`,
                    tone: Number(summary.dead_letter || 0) ? 'danger' : 'muted',
                    active: deadLetterFocusActive,
                    title: deadLetterFocusActive
                        ? '再次点击可清除死信联动筛选'
                        : '点击联动到冲突死信任务与死信子表',
                    action: 'delivery-toggle-conflict-dead-letter-focus'
                })
                : this.renderDeliveryMetaBadge('冲突死信 0', 'muted'),
            this.renderDeliveryMetaBadge(`最新 ${latestConflict}`, summary.latest_conflict_at ? 'neutral' : 'muted'),
            auditSelection?.auditId ? this.renderDeliveryMetaBadge('已锁定上下文', 'processing') : ''
        ];
        if (filters.target_query) {
            pills.push(this.renderDeliveryMetaBadge(`目标 ${this.truncateText(filters.target_query, 22)}`, 'neutral'));
        }
        if (filters.channel_query) {
            pills.push(this.renderDeliveryMetaBadge(`通道 ${this.truncateText(filters.channel_query, 22)}`, 'neutral'));
        }
        if (['target_conflicts', 'channel_conflicts'].includes(activeReason)) {
            pills.push(this.renderDeliveryMetaBadge(`原因 ${this.getDeliveryConflictAuditReasonLabel(activeReason)}`, 'processing'));
        }
        meta.classList.add('shop-delivery-subcard-meta--rich');
        meta.innerHTML = (total || hasAuditFilters) ? pills.join('') : '<span class="shop-delivery-table-note">暂无冲突审计</span>';
    },

    renderConflictAudits: function (records = []) {
        const tbody = document.getElementById('deliveryConflictAuditTableBody');
        if (!tbody) return;
        const activeAuditId = String(this.deliveryConflictAuditSelection?.auditId || '').trim();
        const activeReasonFilter = this.normalizeDeliveryConflictAuditReasonFilter(this.deliveryConflictAuditReasonFilter);
        const activeTargetFilter = String(this.deliveryConflictAuditTargetFilter || '').trim();
        const activeChannelFilter = String(this.deliveryConflictAuditChannelFilter || '').trim();

        if (!records.length) {
            tbody.innerHTML = `<tr><td colspan="5"><div class="shop-delivery-empty">${this.hasDeliveryConflictAuditFilters() ? '当前二次过滤条件下没有命中的冲突审计。' : '当前没有最近冲突记录。'}</div></td></tr>`;
            return;
        }

        tbody.innerHTML = records.map((record) => {
            const task = record.task || {};
            const order = record.order || task.order || {};
            const taskId = this.escapeHtml(this.truncateText(record.task_id || task.id || '—', 18));
            const orderId = this.escapeHtml(record.order_id || task.order_id || '—');
            const resultBadge = this.getDeliveryTaskStatusBadge(record.task_status || task.status || 'retry_waiting');
            const detail = this.escapeHtml(this.truncateText(record.detail || task.last_conflict_note || '无备注', 72));
            const targetKey = String(record.target_key || task.target_key || '').trim();
            const channelKey = String(record.channel_key || task.channel_key || '').trim();
            const rawReasonKey = String(record.conflict_reason?.key || record.reason_key || record.last_conflict_reason || '').trim().toLowerCase();
            const reasonKey = this.normalizeDeliveryConflictAuditReasonFilter(rawReasonKey || 'unknown_conflict') === 'all'
                ? 'unknown_conflict'
                : this.normalizeDeliveryConflictAuditReasonFilter(rawReasonKey || 'unknown_conflict');
            const reasonLabel = record.conflict_reason?.label || this.getDeliveryConflictAuditReasonLabel(reasonKey);
            const reasonTone = record.conflict_reason?.tone || (reasonKey === 'channel_max_inflight'
                ? 'danger'
                : reasonKey === 'manual_force_unlock'
                    ? 'processing'
                    : reasonKey === 'unknown_conflict'
                        ? 'muted'
                        : 'warn');
            const isActive = activeAuditId && activeAuditId === String(record.id || '').trim();
            const encodedRecordId = encodeURIComponent(String(record.id || ''));
            const encodedCreatedAt = encodeURIComponent(String(record.created_at || ''));
            const encodedTaskId = encodeURIComponent(String(record.task_id || task.id || ''));
            const encodedOrderId = encodeURIComponent(String(record.order_id || task.order_id || ''));
            const encodedTargetKey = encodeURIComponent(targetKey);
            const encodedChannelKey = encodeURIComponent(channelKey);
            const encodedReasonKey = encodeURIComponent(String(record.reason_key || record.last_conflict_reason || ''));
            const encodedScope = encodeURIComponent(String(record.scope || record.last_conflict_scope || ''));
            const reasonFilterChip = this.renderDeliveryQuickFilterChip({
                label: reasonLabel,
                tone: reasonTone,
                active: activeReasonFilter === reasonKey,
                title: activeReasonFilter === reasonKey ? '再次点击可清除此原因过滤' : '点击按该冲突原因二次过滤',
                action: 'delivery-conflict-audit-reason-quick-filter',
                actionAttrs: {
                    'delivery-reason-key': encodeURIComponent(reasonKey)
                }
            });
            const targetFilterChip = targetKey
                ? this.renderDeliveryQuickFilterChip({
                    label: this.truncateText(targetKey, 32),
                    tone: 'processing',
                    active: activeTargetFilter === targetKey,
                    title: activeTargetFilter === targetKey ? '再次点击可清除此目标过滤' : '点击按该目标二次过滤',
                    action: 'delivery-conflict-audit-target-quick-filter',
                    actionAttrs: {
                        'delivery-target-key': encodedTargetKey
                    }
                })
                : '<span class="shop-delivery-table-note">—</span>';
            const channelFilterChip = channelKey
                ? this.renderDeliveryQuickFilterChip({
                    label: this.truncateText(channelKey, 24),
                    tone: 'danger',
                    active: activeChannelFilter === channelKey,
                    title: activeChannelFilter === channelKey ? '再次点击可清除此通道过滤' : '点击按该通道二次过滤',
                    action: 'delivery-conflict-audit-channel-quick-filter',
                    actionAttrs: {
                        'delivery-channel-key': encodedChannelKey
                    }
                })
                : '<span class="shop-delivery-table-note">—</span>';

            return `
                <tr
                    class="shop-delivery-audit-row shop-delivery-audit-row--action${isActive ? ' shop-delivery-audit-row--active' : ''}"
                    data-audit-id="${this.escapeHtml(String(record.id || ''))}"
                    data-shop-action="delivery-conflict-audit-select"
                    data-delivery-audit-id="${this.escapeForAttr(encodedRecordId)}"
                    data-delivery-audit-created-at="${this.escapeForAttr(encodedCreatedAt)}"
                    data-delivery-task-id="${this.escapeForAttr(encodedTaskId)}"
                    data-delivery-order-id="${this.escapeForAttr(encodedOrderId)}"
                    data-delivery-target-key="${this.escapeForAttr(encodedTargetKey)}"
                    data-delivery-channel-key="${this.escapeForAttr(encodedChannelKey)}"
                    data-delivery-reason-key="${this.escapeForAttr(encodedReasonKey)}"
                    data-delivery-scope="${this.escapeForAttr(encodedScope)}"
                    title="${isActive ? '再次点击可取消任务锁定' : '点击锁定该任务、对应时间桶和热点上下文'}"
                >
                    <td data-label="时间">
                        <div class="shop-delivery-value">${this.formatDeliveryTime(record.created_at)}</div>
                        <div class="shop-delivery-table-note">${record.worker_name ? `Worker ${this.escapeHtml(record.worker_name)}` : '无 worker'}</div>
                    </td>
                    <td data-label="冲突类型">
                        <div class="shop-delivery-meta shop-delivery-meta--stacked">${reasonFilterChip}</div>
                        <div class="shop-delivery-table-note">${detail}</div>
                    </td>
                    <td data-label="任务 / 订单">
                        <div class="shop-delivery-value">任务 ${taskId}</div>
                        <div class="shop-delivery-table-note">${order.snapshot_product_name ? this.escapeHtml(order.snapshot_product_name) : '无商品'} · 订单 ${orderId}</div>
                    </td>
                    <td data-label="目标 / 通道">
                        <div class="shop-delivery-meta shop-delivery-meta--stacked">${targetFilterChip}</div>
                        <div class="shop-delivery-meta">${channelFilterChip}</div>
                    </td>
                    <td data-label="结果">
                        <div class="shop-delivery-meta shop-delivery-meta--stacked">${resultBadge}</div>
                        <div class="shop-delivery-table-note">${record.next_attempt_at ? `下次 ${this.formatDeliveryTime(record.next_attempt_at)}` : '无重试时间'}${isActive ? ' · 已锁定上下文' : ' · 点击联动'}</div>
                    </td>
                </tr>
            `;
        }).join('');
    },

    renderDeadLetterTasks: function (tasks = [], total = 0, page = 1, pageSize = this.deliveryDeadLetterPageSize) {
        const tbody = document.getElementById('deliveryDeadLetterTableBody');
        if (!tbody) return;

        if (!tasks.length) {
            tbody.innerHTML = '<tr><td colspan="6"><div class="shop-delivery-empty">当前没有死信任务。</div></td></tr>';
            this.renderPagination('deliveryDeadLetterPagination', page, total, pageSize, 'loadDeliveryDeadLetterPage');
            return;
        }

        tbody.innerHTML = tasks.map((task) => {
            const order = task.order || {};
            const isFocused = this.matchesDeliveryTaskIdentity(task);
            const orderId = this.escapeHtml(task.order_id || '—');
            const productName = this.escapeHtml(order.snapshot_product_name || '—');
            const userId = this.escapeHtml(order.user_id || '未知用户');
            const reason = task.last_error
                ? `<div class="shop-delivery-value">${this.escapeHtml(this.truncateText(task.last_error, 54))}</div>`
                : '<div class="shop-delivery-value">人工标记死信</div>';
            const responseMeta = [
                task.last_response_status ? `HTTP ${Number(task.last_response_status)}` : '',
                task.dead_lettered_at ? `死信于 ${this.formatDeliveryTime(task.dead_lettered_at)}` : ''
            ].filter(Boolean).join(' · ');
            const deadLetterReason = task.dead_letter_reason
                ? this.renderDeliveryBadge(task.dead_letter_reason.label, task.dead_letter_reason.tone || 'muted')
                : this.renderDeliveryBadge('未知原因', 'muted');

            return `
                <tr class="${isFocused ? 'shop-delivery-linked-row--focused' : ''}">
                    <td data-label="订单号">
                        <div class="shop-delivery-value">${orderId}</div>
                        <div class="shop-delivery-table-note">${task.target_url ? this.formatDeliveryTaskTarget(task.target_url) : '无目标地址'}</div>
                    </td>
                    <td data-label="商品 / 用户">
                        <div class="shop-delivery-value">${productName}</div>
                        <div class="shop-delivery-table-note">${userId}</div>
                    </td>
                    <td data-label="死信原因" class="shop-delivery-table-cell--relaxed">
                        <div class="shop-delivery-meta shop-delivery-meta--stacked">${deadLetterReason}</div>
                        ${reason}
                        <div class="shop-delivery-table-note shop-delivery-table-note--spaced">${this.escapeHtml(responseMeta || '无额外响应信息')}</div>
                    </td>
                    <td data-label="锁与幂等">${this.renderDeliveryObserveChips(task)}</td>
                    <td data-label="最近尝试">${this.renderDeliveryAttemptLines(task)}</td>
                    <td data-label="操作">
                        ${this.renderDeliveryConflictAuditJumpButton(task)}
                        ${this.renderDeliveryActionButtons(task, { allowDeadLetter: false })}
                    </td>
                </tr>
            `;
        }).join('');

        this.renderPagination('deliveryDeadLetterPagination', page, total, pageSize, 'loadDeliveryDeadLetterPage');
    },

    renderLockConflictTasks: function (tasks = [], total = 0, page = 1, pageSize = this.deliveryLockConflictPageSize) {
        const tbody = document.getElementById('deliveryLockConflictsTableBody');
        if (!tbody) return;

        if (!tasks.length) {
            tbody.innerHTML = '<tr><td colspan="6"><div class="shop-delivery-empty">当前筛选条件下没有锁冲突任务。</div></td></tr>';
            this.renderPagination('deliveryLockConflictsPagination', page, total, pageSize, 'loadDeliveryLockConflictPage');
            return;
        }

        tbody.innerHTML = tasks.map((task) => {
            const order = task.order || {};
            const isFocused = this.matchesDeliveryTaskIdentity(task);
            const orderId = this.escapeHtml(task.order_id || '—');
            const productName = this.escapeHtml(order.snapshot_product_name || '—');
            const userId = this.escapeHtml(order.user_id || '未知用户');
            const lockMeta = [
                task.locked_at ? `锁定 ${this.formatDeliveryTime(task.locked_at)}` : '',
                task.lock_expires_at ? `过期 ${this.formatDeliveryTime(task.lock_expires_at)}` : '',
                task.worker_name ? `Worker ${this.escapeHtml(task.worker_name)}` : ''
            ].filter(Boolean).join(' · ');
            const errorLabel = task.last_error
                ? this.escapeHtml(this.truncateText(task.last_error, 56))
                : '暂无最近错误';

            return `
                <tr class="${isFocused ? 'shop-delivery-linked-row--focused' : ''}">
                    <td data-label="订单号">
                        <div class="shop-delivery-value">${orderId}</div>
                        <div class="shop-delivery-table-note">${task.target_url ? this.formatDeliveryTaskTarget(task.target_url) : '无目标地址'}</div>
                    </td>
                    <td data-label="商品 / 用户">
                        <div class="shop-delivery-value">${productName}</div>
                        <div class="shop-delivery-table-note">${userId}</div>
                    </td>
                    <td data-label="锁状态">
                        <div class="shop-delivery-meta shop-delivery-meta--stacked">
                            ${this.getDeliveryTaskStatusBadge(task.status)}
                            ${this.getDeliveryLockBadge(task)}
                        </div>
                        <div class="shop-delivery-table-note">${this.escapeHtml(lockMeta || '无锁字段元信息')}</div>
                    </td>
                    <td data-label="锁与幂等">
                        ${this.renderDeliveryObserveChips(task)}
                    </td>
                    <td data-label="最近错误 / 尝试" class="shop-delivery-table-cell--relaxed">
                        <div class="shop-delivery-value">${errorLabel}</div>
                        <div class="shop-delivery-table-note shop-delivery-table-note--spaced">尝试 ${Number(task.attempt_count || 0)} / ${Number(task.max_attempts || 0)}</div>
                        <div class="shop-delivery-observe-wrap">${this.renderDeliveryAttemptLines(task)}</div>
                    </td>
                    <td data-label="操作">
                        ${this.renderDeliveryConflictAuditJumpButton(task)}
                        ${this.renderDeliveryActionButtons(task, { allowDeadLetter: task.status !== 'dead_letter', allowForceUnlock: true })}
                    </td>
                </tr>
            `;
        }).join('');

        this.renderPagination('deliveryLockConflictsPagination', page, total, pageSize, 'loadDeliveryLockConflictPage');
    },

    renderReservationSummary: function (data = {}) {
        const meta = document.getElementById('deliveryReservationSummary');
        if (!meta) return;

        const summary = data.summary || {};
        const total = Number(data.total || summary.total || 0);
        const oldestActive = summary.oldest_active_at ? this.formatDeliveryTime(summary.oldest_active_at) : '—';
        const pills = [
            this.renderDeliveryMetaBadge(`快照 ${total} 条`, total ? 'processing' : 'muted'),
            this.renderDeliveryMetaBadge(`生效 ${Number(summary.active || 0)}`, Number(summary.active || 0) ? 'processing' : 'muted'),
            this.renderDeliveryMetaBadge(`漂移 ${Number(summary.drift_total || 0)}`, Number(summary.drift_total || 0) ? 'danger' : 'muted'),
            this.renderDeliveryMetaBadge(`Token 漂移 ${Number(summary.token_drift || 0)}`, Number(summary.token_drift || 0) ? 'danger' : 'muted'),
            this.renderDeliveryMetaBadge(`Worker 漂移 ${Number(summary.worker_drift || 0)}`, Number(summary.worker_drift || 0) ? 'danger' : 'muted'),
            this.renderDeliveryMetaBadge(`过期 ${Number(summary.stale_lock || 0)}`, Number(summary.stale_lock || 0) ? 'danger' : 'muted'),
            this.renderDeliveryMetaBadge(`缺锁 ${Number(summary.missing_lock || 0)}`, Number(summary.missing_lock || 0) ? 'danger' : 'muted'),
            this.renderDeliveryMetaBadge(`残留 ${Number(summary.released_pending_cleanup || 0)}`, Number(summary.released_pending_cleanup || 0) ? 'warn' : 'muted'),
            this.renderDeliveryMetaBadge(`热目标 ${Number(summary.distinct_targets || 0)}`, Number(summary.distinct_targets || 0) ? 'neutral' : 'muted'),
            this.renderDeliveryMetaBadge(`热通道 ${Number(summary.distinct_channels || 0)}`, Number(summary.distinct_channels || 0) ? 'neutral' : 'muted'),
            this.renderDeliveryMetaBadge(`最老活跃 ${oldestActive}`, summary.oldest_active_at ? 'neutral' : 'muted')
        ];

        meta.classList.add('shop-delivery-subcard-meta--rich');
        meta.innerHTML = total ? pills.join('') : '<span class="shop-delivery-table-note">当前没有全局占位快照</span>';
    },

    renderReservationTasks: function (tasks = []) {
        const tbody = document.getElementById('deliveryReservationTableBody');
        if (!tbody) return;

        if (!tasks.length) {
            tbody.innerHTML = '<tr><td colspan="6"><div class="shop-delivery-empty">当前没有全局占位或锁漂移任务。</div></td></tr>';
            return;
        }

        tbody.innerHTML = tasks.map((task) => {
            const order = task.order || {};
            const isFocused = this.matchesDeliveryTaskIdentity(task);
            const orderId = this.escapeHtml(task.order_id || '—');
            const productName = this.escapeHtml(order.snapshot_product_name || '—');
            const userId = this.escapeHtml(order.user_id || '未知用户');
            const reservationBadge = this.getDeliveryReservationBadge(task) || this.renderDeliveryBadge('无占位', 'muted');
            const stateBadges = [
                reservationBadge,
                this.getDeliveryTaskStatusBadge(task.status),
                this.getDeliveryLockBadge(task)
            ].filter(Boolean).join('');
            const reservationMeta = [
                task.reservation_acquired_at ? `占位于 ${this.formatDeliveryTime(task.reservation_acquired_at)}` : '',
                task.reservation_acquired_at ? `持续 ${this.formatDeliveryAge(task.reservation_acquired_at)}` : '',
                task.reservation_worker_name ? `占位 Worker ${task.reservation_worker_name}` : '',
                task.reservation_lock_token ? `占位锁 ${this.shortenDeliveryToken(task.reservation_lock_token, 8, 6)}` : ''
            ].filter(Boolean).join(' · ');
            const currentLockMeta = [
                task.worker_name ? `当前 Worker ${task.worker_name}` : '',
                task.locked_at ? `锁定 ${this.formatDeliveryTime(task.locked_at)}` : '',
                task.lock_expires_at ? `过期 ${this.formatDeliveryTime(task.lock_expires_at)}` : '',
                task.lock_token ? `当前锁 ${this.shortenDeliveryToken(task.lock_token, 8, 6)}` : ''
            ].filter(Boolean).join(' · ');

            return `
                <tr class="${isFocused ? 'shop-delivery-linked-row--focused' : ''}">
                    <td data-label="状态">
                        <div class="shop-delivery-meta shop-delivery-meta--stacked">${stateBadges}</div>
                        <div class="shop-delivery-table-note">${task.last_conflict_reason ? this.escapeHtml(task.last_conflict_reason) : '无最近冲突原因'}</div>
                    </td>
                    <td data-label="任务 / 订单">
                        <div class="shop-delivery-value">任务 ${this.escapeHtml(this.truncateText(task.id || '—', 18))}</div>
                        <div class="shop-delivery-table-note">订单 ${orderId}</div>
                    </td>
                    <td data-label="商品 / 用户">
                        <div class="shop-delivery-value">${productName}</div>
                        <div class="shop-delivery-table-note">${userId}</div>
                    </td>
                    <td data-label="目标 / 通道">
                        <div class="shop-delivery-value">${this.escapeHtml(this.truncateText(task.target_key || task.target_url || '—', 34))}</div>
                        <div class="shop-delivery-table-note">${this.escapeHtml(this.truncateText(task.channel_key || '—', 26))}</div>
                    </td>
                    <td data-label="占位 / 当前锁" class="shop-delivery-table-cell--relaxed">
                        <div class="shop-delivery-value">${this.escapeHtml(reservationMeta || '无占位快照')}</div>
                        <div class="shop-delivery-table-note shop-delivery-table-note--spaced">${this.escapeHtml(currentLockMeta || '当前无活跃锁信息')}</div>
                        <div class="shop-delivery-observe-wrap">${this.renderDeliveryObserveChips(task)}</div>
                    </td>
                    <td data-label="操作">
                        ${this.renderDeliveryConflictAuditJumpButton(task)}
                        ${this.renderDeliveryActionButtons(task, { allowDeadLetter: task.status !== 'dead_letter', allowForceUnlock: true })}
                    </td>
                </tr>
            `;
        }).join('');
    },

    renderDeliveryHotspotList: function (elementId, items = [], type = 'target') {
        const target = document.getElementById(elementId);
        if (!target) return;
        const windowConfig = this.getDeliveryAnalyticsWindowConfig();
        const activeConflictReason = this.normalizeDeliveryConflictAuditReasonFilter(this.deliveryConflictAuditReasonFilter);

        if (!items.length) {
            target.innerHTML = `<div class="shop-delivery-empty">${windowConfig.description}没有明显热点。</div>`;
            return;
        }

        const maxConflicts = items.reduce((max, item) => Math.max(max, Number(item?.total_conflicts || 0)), 1);
        target.innerHTML = items.map((item, index) => {
            const encodedKey = encodeURIComponent(String(item.key || '').trim());
            const keyText = this.escapeHtml(this.truncateText(item.key || '—', type === 'target' ? 42 : 28));
            const totalConflicts = Number(item.total_conflicts || 0);
            const width = Math.max(12, Math.round((totalConflicts / maxConflicts) * 100));
            const isActive = this.isDeliveryHotspotQueryActive(type, item.key);
            const isManualActive = isActive && activeConflictReason === 'manual_force_unlock';
            const isDeadLetterActive = isActive && this.isDeliveryConflictDeadLetterFocusActive();
            const latestReasonKey = this.normalizeDeliveryConflictAuditReasonFilter(item.latest_reason_key || 'all');
            const hasLatestReason = totalConflicts > 0 && latestReasonKey !== 'all';
            const isLatestReasonActive = isActive && activeConflictReason === latestReasonKey;
            const meta = [
                this.renderDeliveryMetaBadge(`冲突 ${totalConflicts}`, totalConflicts ? 'warn' : 'muted'),
                this.renderDeliveryMetaBadge(`活跃占位 ${Number(item.active_reservations || 0)}`, Number(item.active_reservations || 0) ? 'processing' : 'muted'),
                (Number(item.dead_letter_count || 0) || isDeadLetterActive)
                    ? this.renderDeliveryQuickFilterChip({
                        label: `冲突死信 ${Number(item.dead_letter_count || 0)}`,
                        tone: Number(item.dead_letter_count || 0) ? 'danger' : 'muted',
                        active: isDeadLetterActive,
                        title: isDeadLetterActive ? '再次点击可退出该热点的冲突死信下钻' : '点击下钻到该热点的冲突死信',
                        action: 'delivery-hotspot-metric-drilldown',
                        actionAttrs: {
                            'delivery-hotspot-type': type,
                            'delivery-hotspot-key': encodedKey,
                            'delivery-hotspot-metric': 'dead_letter'
                        }
                    })
                    : this.renderDeliveryMetaBadge('冲突死信 0', 'muted'),
                (Number(item.manual_count || 0) || isManualActive)
                    ? this.renderDeliveryQuickFilterChip({
                        label: `人工 ${Number(item.manual_count || 0)}`,
                        tone: Number(item.manual_count || 0) ? 'neutral' : 'muted',
                        active: isManualActive,
                        title: isManualActive ? '再次点击可退出该热点的人工冲突下钻' : '点击下钻到该热点的人工冲突',
                        action: 'delivery-hotspot-metric-drilldown',
                        actionAttrs: {
                            'delivery-hotspot-type': type,
                            'delivery-hotspot-key': encodedKey,
                            'delivery-hotspot-metric': 'manual'
                        }
                    })
                    : this.renderDeliveryMetaBadge('人工 0', 'muted'),
                item.latest_reason_label
                    ? (
                        hasLatestReason
                            ? this.renderDeliveryQuickFilterChip({
                                label: item.latest_reason_label,
                                tone: this.getDeliveryConflictReasonTone(latestReasonKey),
                                active: isLatestReasonActive,
                                title: isLatestReasonActive ? '再次点击可退出该热点的最新原因下钻' : '点击按该热点的最新原因下钻',
                                action: 'delivery-hotspot-reason-drilldown',
                                actionAttrs: {
                                    'delivery-hotspot-type': type,
                                    'delivery-hotspot-key': encodedKey,
                                    'delivery-reason-key': encodeURIComponent(latestReasonKey)
                                }
                            })
                            : this.renderDeliveryMetaBadge(item.latest_reason_label, 'neutral')
                    )
                    : '',
                item.latest_at ? this.renderDeliveryMetaBadge(`最近 ${this.formatDeliveryTime(item.latest_at)}`, 'muted') : '',
                this.renderDeliveryMetaBadge(isActive ? '已联动履约页' : '点击联动履约页', isActive ? 'processing' : 'muted')
            ].filter(Boolean);

            return `
                <div class="shop-delivery-hotspot-item shop-delivery-hotspot-item--interactive${isActive ? ' shop-delivery-hotspot-item--active' : ''}">
                    <button
                        type="button"
                        class="shop-delivery-hotspot-hitarea"
                        data-shop-action="delivery-hotspot-filter"
                        data-delivery-hotspot-type="${this.escapeForAttr(type)}"
                        data-delivery-hotspot-key="${this.escapeForAttr(encodedKey)}"
                        title="点击按${type === 'channel' ? '通道' : '目标'}联动履约页"
                    >
                        <div class="shop-delivery-hotspot-topline">
                            <div class="shop-delivery-hotspot-key" title="${this.escapeHtml(item.key || '')}">${keyText}</div>
                            <div class="shop-delivery-hotspot-rank">#${index + 1}</div>
                        </div>
                        <progress class="shop-delivery-hotspot-progress" max="100" value="${width}"></progress>
                    </button>
                    <div class="shop-delivery-hotspot-meta">${meta.join('')}</div>
                </div>
            `;
        }).join('');
    },

    renderDeliveryConflictAnalytics: function (analytics = {}) {
        const summary = document.getElementById('deliveryConflictAnalyticsSummary');
        const chart = document.getElementById('deliveryConflictTrendChart');
        const legend = document.getElementById('deliveryConflictTrendLegend');
        const windowFilter = document.getElementById('deliveryAnalyticsWindowFilter');
        const trend = analytics.trend || {};
        const hotspots = analytics.hotspots || {};
        const buckets = Array.isArray(trend.buckets) ? trend.buckets : [];
        const windowConfig = analytics.window || this.getDeliveryAnalyticsWindowConfig();
        const windowLabel = windowConfig.label || this.getDeliveryAnalyticsWindowConfig().label;
        const windowDescription = windowConfig.description || this.getDeliveryAnalyticsWindowConfig().description;
        const activeBucket = this.deliveryConflictBucketFilter || {};

        if (windowFilter && windowFilter.value !== String(windowConfig.key || this.deliveryAnalyticsWindow)) {
            windowFilter.value = String(windowConfig.key || this.deliveryAnalyticsWindow);
        }

        if (summary) {
            const summaryData = analytics.summary || {};
            const hottest = summaryData.hottest_hour_label
                ? `${summaryData.hottest_hour_label} · ${Number(summaryData.hottest_hour_total || 0)}`
                : '—';
            const pills = [
                this.renderDeliveryMetaBadge(`${windowLabel} 冲突 ${Number(summaryData.total_conflicts || 0)}`, Number(summaryData.total_conflicts || 0) ? 'warn' : 'muted'),
                this.renderDeliveryMetaBadge(`目标 ${Number(summaryData.target_conflicts || 0)}`, Number(summaryData.target_conflicts || 0) ? 'processing' : 'muted'),
                this.renderDeliveryMetaBadge(`通道 ${Number(summaryData.channel_conflicts || 0)}`, Number(summaryData.channel_conflicts || 0) ? 'danger' : 'muted'),
                this.renderDeliveryMetaBadge(`人工 ${Number(summaryData.manual_conflicts || 0)}`, Number(summaryData.manual_conflicts || 0) ? 'neutral' : 'muted'),
                this.renderDeliveryMetaBadge(`冲突死信 ${Number(summaryData.dead_letter_conflicts || 0)}`, Number(summaryData.dead_letter_conflicts || 0) ? 'danger' : 'muted'),
                this.renderDeliveryMetaBadge(`分桶 ${Number(summaryData.bucket_hours || trend.bucket_hours || 1)}h`, 'muted'),
                this.renderDeliveryMetaBadge(`高峰 ${hottest}`, summaryData.hottest_hour_total ? 'warn' : 'muted')
            ];
            summary.classList.add('shop-delivery-subcard-meta--rich');
            summary.innerHTML = pills.join('');
        }

        if (chart && legend) {
            const maxValue = buckets.reduce((max, bucket) => Math.max(max, Number(bucket?.total || 0)), 1);
            const viewportWidth = window.innerWidth || 1280;
            const labelStep = viewportWidth <= 480 ? 6 : viewportWidth <= 768 ? 4 : 2;
            const hasData = buckets.some((bucket) => Number(bucket?.total || 0) > 0);

            if (!buckets.length || !hasData) {
                chart.innerHTML = `<div class="shop-delivery-empty">${windowDescription}暂无冲突记录。</div>`;
                legend.innerHTML = '';
            } else {
                chart.innerHTML = `
                    <div class="shop-delivery-trend-bars">
                        ${buckets.map((bucket, index) => {
                            const totalHeight = Math.max(8, Math.round((Number(bucket.total || 0) / maxValue) * 100));
                            const deadHeight = Number(bucket.dead_letter || 0)
                                ? Math.max(4, Math.round((Number(bucket.dead_letter || 0) / maxValue) * 100))
                                : 0;
                            const showLabel = index % labelStep === 0 || index === buckets.length - 1;
                            const bucketLabel = String(bucket.label || '');
                            const bucketLabelHtml = Number(trend.bucket_hours || 1) > 1
                                ? this.escapeHtml(bucketLabel).replace(' ', '<br>')
                                : this.escapeHtml(bucketLabel.split(' ')[1] || bucketLabel);
                            const isActive = this.isDeliveryConflictBucketActive(bucket.bucket_at, bucket.bucket_end_at, activeBucket);
                            const isDeadActive = isActive && this.isDeliveryConflictDeadLetterFocusActive();
                            const isClickable = Number(bucket.total || 0) > 0;
                            const titleText = `${bucket.label || ''} · 总冲突 ${Number(bucket.total || 0)} · 目标 ${Number(bucket.target || 0)} · 通道 ${Number(bucket.channel || 0)} · 人工 ${Number(bucket.manual || 0)} · 冲突死信 ${Number(bucket.dead_letter || 0)}`;
                            if (!isClickable) {
                                return `
                                    <div class="shop-delivery-trend-bar" title="${this.escapeHtml(titleText)}">
                                        <div class="shop-delivery-trend-bar-stack">
                                            <div class="shop-delivery-trend-bar-column">
                                                ${this.renderDeliveryTrendBarSvg(totalHeight, deadHeight)}
                                            </div>
                                        </div>
                                        <span>${showLabel ? bucketLabelHtml : ''}</span>
                                    </div>
                                `;
                            }
                            return `
                                <div class="shop-delivery-trend-bar${isActive ? ' shop-delivery-trend-bar--active' : ''}${isDeadActive ? ' shop-delivery-trend-bar--dead-active' : ''}">
                                    <div class="shop-delivery-trend-bar-stack">
                                        <button
                                            type="button"
                                            class="shop-delivery-trend-bar-hitarea shop-delivery-trend-bar--action"
                                            data-shop-action="delivery-conflict-bucket-toggle"
                                            data-delivery-bucket-start="${this.escapeForAttr(encodeURIComponent(bucket.bucket_at || ''))}"
                                            data-delivery-bucket-end="${this.escapeForAttr(encodeURIComponent(bucket.bucket_end_at || ''))}"
                                            data-delivery-bucket-label="${this.escapeForAttr(encodeURIComponent(bucket.label || ''))}"
                                            title="${this.escapeHtml(titleText)}"
                                        >
                                            <div class="shop-delivery-trend-bar-column">
                                                ${this.renderDeliveryTrendBarSvg(totalHeight, deadHeight)}
                                            </div>
                                        </button>
                                        ${deadHeight ? `
                                            <svg
                                                class="shop-delivery-trend-bar-dead-hitarea${isDeadActive ? ' shop-delivery-trend-bar-dead-hitarea--active' : ''}"
                                                viewBox="0 0 14 100"
                                                preserveAspectRatio="none"
                                                aria-hidden="true"
                                            >
                                                <rect
                                                    class="shop-delivery-trend-bar-dead-fill"
                                                    x="0"
                                                    y="${100 - deadHeight}"
                                                    width="14"
                                                    height="${deadHeight}"
                                                    rx="7"
                                                    ry="7"
                                                    data-shop-action="delivery-conflict-bucket-dead-letter-focus"
                                                    data-delivery-bucket-start="${this.escapeForAttr(encodeURIComponent(bucket.bucket_at || ''))}"
                                                    data-delivery-bucket-end="${this.escapeForAttr(encodeURIComponent(bucket.bucket_end_at || ''))}"
                                                    data-delivery-bucket-label="${this.escapeForAttr(encodeURIComponent(bucket.label || ''))}"
                                                    title="${this.escapeHtml(`${bucket.label || ''} · 冲突死信 ${Number(bucket.dead_letter || 0)} · 点击联动死信任务与冲突策略`)}"
                                                ></rect>
                                            </svg>
                                        ` : ''}
                                    </div>
                                    <span>${showLabel ? bucketLabelHtml : ''}</span>
                                </div>
                            `;
                        }).join('')}
                    </div>
                `;

                legend.innerHTML = `
                    ${this.renderDeliveryTrendLegendButton({
                        label: `${windowLabel} 总冲突 ${Number(trend.total_conflicts || 0)}`,
                        tone: 'neutral',
                        active: this.isDeliveryConflictTrendLegendActive('total'),
                        title: '点击清除冲突类型反筛',
                        action: 'delivery-conflict-audit-reason-quick-filter',
                        actionAttrs: {
                            'delivery-reason-key': encodeURIComponent('all')
                        }
                    })}
                    ${this.renderDeliveryTrendLegendButton({
                        label: `目标 ${Number(trend.target_conflicts || 0)}`,
                        tone: 'processing',
                        active: this.isDeliveryConflictTrendLegendActive('target'),
                        title: '点击按目标类冲突反筛冲突审计',
                        action: 'delivery-conflict-audit-reason-quick-filter',
                        actionAttrs: {
                            'delivery-reason-key': encodeURIComponent('target_conflicts')
                        }
                    })}
                    ${this.renderDeliveryTrendLegendButton({
                        label: `通道 ${Number(trend.channel_conflicts || 0)}`,
                        tone: 'danger',
                        active: this.isDeliveryConflictTrendLegendActive('channel'),
                        title: '点击按通道类冲突反筛冲突审计',
                        action: 'delivery-conflict-audit-reason-quick-filter',
                        actionAttrs: {
                            'delivery-reason-key': encodeURIComponent('channel_conflicts')
                        }
                    })}
                    ${this.renderDeliveryTrendLegendButton({
                        label: `人工 ${Number(trend.manual_conflicts || 0)}`,
                        tone: 'neutral',
                        active: this.isDeliveryConflictTrendLegendActive('manual'),
                        title: '点击按人工冲突反筛冲突审计',
                        action: 'delivery-conflict-audit-reason-quick-filter',
                        actionAttrs: {
                            'delivery-reason-key': encodeURIComponent('manual_force_unlock')
                        }
                    })}
                    ${this.renderDeliveryTrendLegendButton({
                        label: `冲突死信 ${Number(trend.dead_letter_conflicts || 0)}`,
                        tone: 'danger',
                        active: this.isDeliveryConflictTrendLegendActive('dead_letter'),
                        title: '点击联动冲突死信任务与死信子表',
                        action: 'delivery-toggle-conflict-dead-letter-focus'
                    })}
                `;
            }
        }

        this.renderDeliveryHotspotList('deliveryTargetHotspots', hotspots.targets || [], 'target');
        this.renderDeliveryHotspotList('deliveryChannelHotspots', hotspots.channels || [], 'channel');
    },

    renderReplayRecords: function (records = [], total = 0, page = 1, pageSize = this.deliveryReplayPageSize) {
        const tbody = document.getElementById('deliveryReplayTableBody');
        if (!tbody) return;

        if (!records.length) {
            tbody.innerHTML = '<tr><td colspan="6"><div class="shop-delivery-empty">当前没有人工重放记录。</div></td></tr>';
            this.renderPagination('deliveryReplayPagination', page, total, pageSize, 'loadDeliveryReplayPage');
            return;
        }

        tbody.innerHTML = records.map((record) => {
            const task = record.task || {};
            const order = record.order || task.order || {};
            const adminIdentity = this.escapeHtml(record.admin_email || record.admin_id || '未知管理员');
            const productName = this.escapeHtml(order.snapshot_product_name || '—');
            const orderId = this.escapeHtml(record.order_id || task.order_id || '—');
            const transition = [record.previous_status, record.next_status]
                .filter(Boolean)
                .map((value) => this.getDeliveryTaskStatusBadge(value))
                .join('<span class="shop-delivery-transition-separator">→</span>');
            const currentState = [
                task.status ? this.getDeliveryTaskStatusBadge(task.status) : this.renderDeliveryBadge('任务缺失', 'danger'),
                order.delivery_status ? this.getOrderDeliveryStatusBadge(order) : ''
            ].filter(Boolean).join('');
            const noteText = record.note
                ? `<div class="shop-delivery-table-note shop-delivery-table-note--spaced">备注：${this.escapeHtml(this.truncateText(record.note, 48))}</div>`
                : '';

            return `
                <tr>
                    <td data-label="时间">
                        <div class="shop-delivery-value">${this.formatDeliveryTime(record.created_at)}</div>
                        <div class="shop-delivery-table-note">${record.task_id ? `任务 ${this.escapeHtml(this.truncateText(record.task_id, 18))}` : '无任务 ID'}</div>
                    </td>
                    <td data-label="管理员">
                        <div class="shop-delivery-value">${adminIdentity}</div>
                    </td>
                    <td data-label="订单 / 商品">
                        <div class="shop-delivery-value">${productName}</div>
                        <div class="shop-delivery-table-note">${orderId}</div>
                    </td>
                    <td data-label="状态流转">
                        <div class="shop-delivery-meta">${transition || this.renderDeliveryBadge('状态未知', 'muted')}</div>
                        <div class="shop-delivery-table-note shop-delivery-table-note--spaced">${record.previous_status && record.next_status ? '人工重放触发了一次状态迁移' : '仅记录了重放动作，状态可能已被后续 worker 覆盖'}</div>
                        ${noteText}
                    </td>
                    <td data-label="重放次数">
                        <div class="shop-delivery-value shop-delivery-value--strong">${Number(record.manual_replay_count || task.manual_replay_count || 0)}</div>
                        <div class="shop-delivery-table-note">累计人工触发次数</div>
                    </td>
                    <td data-label="当前状态">
                        <div class="shop-delivery-meta">${currentState}</div>
                        <div class="shop-delivery-observe-wrap">${this.renderDeliveryCompactObserveChips(record)}</div>
                    </td>
                </tr>
            `;
        }).join('');

        this.renderPagination('deliveryReplayPagination', page, total, pageSize, 'loadDeliveryReplayPage');
    },

    loadDeliveryStrategy: async function (headers = null) {
        if (this.isDeliveryMockModeEnabled()) {
            const config = this.cloneDeliveryMockValue(this.ensureDeliveryMockStore().strategy || {});
            this.renderDeliveryStrategy(config);
            return config;
        }

        const requestHeaders = headers || await this.getAdminAuthHeaders();
        const response = await fetch(this.buildAdminShopUrl('shop/delivery-strategy'), {
            method: 'GET',
            headers: requestHeaders
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.success) {
            throw new Error(result.message || '履约策略加载失败');
        }

        this.renderDeliveryStrategy(result.config || {});
        return result.config || {};
    },

    saveDeliveryStrategy: async function () {
        const saveButton = document.getElementById('deliveryStrategySaveBtn');
        const originalText = saveButton?.innerHTML || '保存策略';
        const applyToOpenTasks = document.getElementById('deliveryStrategyApplyOpenTasks')?.checked !== false;

        try {
            if (saveButton) {
                saveButton.disabled = true;
                saveButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 保存中...';
            }

            if (this.isDeliveryMockModeEnabled()) {
                const store = this.ensureDeliveryMockStore();
                store.strategy = {
                    ...store.strategy,
                    ...this.getDeliveryStrategyPayload()
                };
                this.renderDeliveryStrategy(store.strategy);
                alert('模拟验收：履约策略已保存到本地 mock 数据');
                await this.loadDeliveryTasks(this.deliveryTaskPage || 1);
                return;
            }

            const headers = await this.getAdminAuthHeaders();
            const response = await fetch(this.buildAdminShopUrl('shop/delivery-strategy'), {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    config: this.getDeliveryStrategyPayload(),
                    applyToOpenTasks
                })
            });

            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.success) {
                throw new Error(result.message || '履约策略保存失败');
            }

            this.renderDeliveryStrategy(result.config || {});
            alert(result.message || '履约策略已保存');
            await this.loadDeliveryTasks(this.deliveryTaskPage || 1);
        } catch (err) {
            console.error('[ShopAdmin] saveDeliveryStrategy failed:', err);
            this.renderDeliveryStrategyError('策略保存失败');
            alert(`履约策略保存失败：${err.message || '未知错误'}`);
        } finally {
            if (saveButton) {
                saveButton.disabled = false;
                saveButton.innerHTML = originalText;
            }
        }
    },

    loadDeliveryTasks: async function (page = 1) {
        this.deliveryTaskPage = page;
        const loadGeneration = Number(this.shopTabLoadGeneration.fulfillment || 0);
        this.shopTabLoadState.fulfillment = 'loading';
        const tbody = document.getElementById('deliveryTasksTableBody');
        const summary = document.getElementById('deliveryTaskSummary');
        const filterHint = document.getElementById('deliveryTaskFilterHint');
        const deadLetterBody = document.getElementById('deliveryDeadLetterTableBody');
        const lockBody = document.getElementById('deliveryLockConflictsTableBody');
        const reservationBody = document.getElementById('deliveryReservationTableBody');
        const replayBody = document.getElementById('deliveryReplayTableBody');
        const conflictAuditBody = document.getElementById('deliveryConflictAuditTableBody');
        const conflictAnalyticsSummary = document.getElementById('deliveryConflictAnalyticsSummary');
        const conflictTrendChart = document.getElementById('deliveryConflictTrendChart');
        const conflictTrendLegend = document.getElementById('deliveryConflictTrendLegend');
        const targetHotspots = document.getElementById('deliveryTargetHotspots');
        const channelHotspots = document.getElementById('deliveryChannelHotspots');
        const deadLetterSummary = document.getElementById('deliveryDeadLetterSummary');
        const lockSummary = document.getElementById('deliveryLockConflictSummary');
        const reservationSummary = document.getElementById('deliveryReservationSummary');
        const replaySummary = document.getElementById('deliveryReplaySummary');
        const conflictAuditSummary = document.getElementById('deliveryConflictAuditSummary');
        const strategySummary = document.getElementById('deliveryStrategySummary');
        const taskFilter = document.getElementById('deliveryTaskStatusFilter');
        const taskQueryInput = document.getElementById('deliveryTaskQueryInput');
        const analyticsWindowFilter = document.getElementById('deliveryAnalyticsWindowFilter');
        const deadLetterReasonFilter = document.getElementById('deliveryDeadLetterReasonFilter');
        const lockStateFilter = document.getElementById('deliveryLockStateFilter');
        const conflictAuditReasonFilter = document.getElementById('deliveryConflictAuditReasonFilter');
        const conflictAuditTargetInput = document.getElementById('deliveryConflictAuditTargetFilter');
        const conflictAuditChannelInput = document.getElementById('deliveryConflictAuditChannelFilter');
        const status = taskFilter?.value || this.deliveryTaskStatusFilter || 'all';
        const analyticsWindow = analyticsWindowFilter?.value || this.deliveryAnalyticsWindow || '24h';
        const analyticsWindowConfig = this.getDeliveryAnalyticsWindowConfig(analyticsWindow);
        const deadLetterReason = deadLetterReasonFilter?.value || this.deliveryDeadLetterReasonFilter || 'all';
        const lockState = lockStateFilter?.value || this.deliveryLockStateFilter || 'all';
        const conflictReason = this.normalizeDeliveryConflictAuditReasonFilter(conflictAuditReasonFilter?.value || this.deliveryConflictAuditReasonFilter || 'all');
        const conflictTarget = String(conflictAuditTargetInput?.value || this.deliveryConflictAuditTargetFilter || '').trim();
        const conflictChannel = String(conflictAuditChannelInput?.value || this.deliveryConflictAuditChannelFilter || '').trim();
        const query = String(this.deliveryTaskQuery || '').trim();
        const conflictBucket = this.deliveryConflictBucketFilter || null;
        const taskIdentity = this.deliveryTaskIdentityFilter || null;

        this.deliveryTaskStatusFilter = status;
        this.deliveryDeadLetterReasonFilter = deadLetterReason;
        this.deliveryLockStateFilter = lockState;
        this.deliveryAnalyticsWindow = analyticsWindowConfig.key;
        this.deliveryConflictAuditReasonFilter = conflictReason;
        this.deliveryConflictAuditTargetFilter = conflictTarget;
        this.deliveryConflictAuditChannelFilter = conflictChannel;

        if (taskFilter && taskFilter.value !== status) taskFilter.value = status;
        if (taskQueryInput && taskQueryInput.value !== query) taskQueryInput.value = query;
        if (analyticsWindowFilter && analyticsWindowFilter.value !== analyticsWindowConfig.key) analyticsWindowFilter.value = analyticsWindowConfig.key;
        if (deadLetterReasonFilter && deadLetterReasonFilter.value !== deadLetterReason) deadLetterReasonFilter.value = deadLetterReason;
        if (lockStateFilter && lockStateFilter.value !== lockState) lockStateFilter.value = lockState;
        if (conflictAuditReasonFilter && conflictAuditReasonFilter.value !== conflictReason) conflictAuditReasonFilter.value = conflictReason;
        if (conflictAuditTargetInput && conflictAuditTargetInput.value !== conflictTarget) conflictAuditTargetInput.value = conflictTarget;
        if (conflictAuditChannelInput && conflictAuditChannelInput.value !== conflictChannel) conflictAuditChannelInput.value = conflictChannel;
        this.renderDeliveryTaskFilterHint();
        this.syncShopUrlState();

        if (tbody) {
            tbody.innerHTML = this.buildDeliveryTasksLoadingSkeleton(4);
        }
        if (summary) {
            summary.innerHTML = this.buildDeliveryMetaLoadingSkeleton();
        }
        if (filterHint && !this.hasDeliveryActiveFilterBreadcrumbs()) {
            filterHint.innerHTML = `
                <div class="shop-delivery-filter-banner shop-delivery-filter-banner--idle">
                    <span class="shop-delivery-table-note">当前未联动筛选履约页。你可以输入关键字，或直接点击下方热点、趋势柱、冲突审计记录，把目标 / 通道 / 冲突时段 / 任务锁定回填到任务、死信、锁冲突和占位面板里。</span>
                </div>
            `;
        }
        if (deadLetterBody) {
            deadLetterBody.innerHTML = this.buildDeliveryDeadLetterLoadingSkeleton(3);
        }
        if (lockBody) {
            lockBody.innerHTML = this.buildDeliveryLockConflictLoadingSkeleton(3);
        }
        if (reservationBody) {
            reservationBody.innerHTML = this.buildDeliveryReservationLoadingSkeleton(3);
        }
        if (replayBody) {
            replayBody.innerHTML = this.buildDeliveryReplayLoadingSkeleton(3);
        }
        if (conflictAuditBody) {
            conflictAuditBody.innerHTML = this.buildDeliveryConflictAuditLoadingSkeleton(3);
        }
        if (conflictTrendChart) {
            conflictTrendChart.innerHTML = this.buildDeliveryTrendLoadingSkeleton();
        }
        if (conflictTrendLegend) {
            conflictTrendLegend.innerHTML = '';
        }
        if (targetHotspots) {
            targetHotspots.innerHTML = this.buildDeliveryHotspotLoadingSkeleton();
        }
        if (channelHotspots) {
            channelHotspots.innerHTML = this.buildDeliveryHotspotLoadingSkeleton();
        }
        if (conflictAnalyticsSummary) {
            conflictAnalyticsSummary.classList.add('shop-delivery-subcard-meta--rich');
            conflictAnalyticsSummary.innerHTML = this.buildDeliveryMetaLoadingSkeleton({ rich: true });
        }
        if (deadLetterSummary) {
            deadLetterSummary.classList.add('shop-delivery-subcard-meta--rich');
            deadLetterSummary.innerHTML = this.buildDeliveryMetaLoadingSkeleton({ rich: true });
        }
        if (lockSummary) {
            lockSummary.classList.add('shop-delivery-subcard-meta--rich');
            lockSummary.innerHTML = this.buildDeliveryMetaLoadingSkeleton({ rich: true });
        }
        if (reservationSummary) {
            reservationSummary.classList.add('shop-delivery-subcard-meta--rich');
            reservationSummary.innerHTML = this.buildDeliveryMetaLoadingSkeleton({ rich: true });
        }
        if (replaySummary) {
            replaySummary.classList.add('shop-delivery-subcard-meta--rich');
            replaySummary.innerHTML = this.buildDeliveryMetaLoadingSkeleton({ rich: true });
        }
        if (conflictAuditSummary) {
            conflictAuditSummary.classList.add('shop-delivery-subcard-meta--rich');
            conflictAuditSummary.innerHTML = this.buildDeliveryMetaLoadingSkeleton({ rich: true });
        }
        if (strategySummary && !this.deliveryStrategyConfig) {
            strategySummary.classList.add('shop-delivery-subcard-meta--rich');
            strategySummary.innerHTML = this.buildDeliveryMetaLoadingSkeleton({ rich: true });
        }

        try {
            const requestPayload = {
                page: Number(page || 1),
                pageSize: Number(this.deliveryTaskPageSize || 8),
                status,
                query,
                analyticsWindow: analyticsWindowConfig.key,
                conflictBucket,
                conflictReason,
                conflictTarget,
                conflictChannel,
                taskIdentity,
                deadLetterPage: Number(this.deliveryDeadLetterPage || 1),
                deadLetterPageSize: Number(this.deliveryDeadLetterPageSize || 5),
                deadLetterReason,
                lockPage: Number(this.deliveryLockConflictPage || 1),
                lockPageSize: Number(this.deliveryLockConflictPageSize || 5),
                lockState,
                replayPage: Number(this.deliveryReplayPage || 1),
                replayPageSize: Number(this.deliveryReplayPageSize || 5)
            };

            let strategyPromise;
            let result;

            if (this.isDeliveryMockModeEnabled()) {
                strategyPromise = this.loadDeliveryStrategy().catch((error) => {
                    console.error('[ShopAdmin] loadDeliveryStrategy failed:', error);
                    this.renderDeliveryStrategyError('策略加载失败');
                    return null;
                });
                result = this.buildDeliveryMockResponse(requestPayload);
            } else {
                const headers = await this.getAdminAuthHeaders();
                strategyPromise = this.loadDeliveryStrategy(headers).catch((error) => {
                    console.error('[ShopAdmin] loadDeliveryStrategy failed:', error);
                    this.renderDeliveryStrategyError('策略加载失败');
                    return null;
                });

                const params = new URLSearchParams({
                    page: String(requestPayload.page),
                    pageSize: String(requestPayload.pageSize),
                    status,
                    query,
                    analyticsWindow: analyticsWindowConfig.key,
                    conflictBucketStartAt: conflictBucket?.startAt || '',
                    conflictBucketEndAt: conflictBucket?.endAt || '',
                    conflictReason,
                    conflictTarget,
                    conflictChannel,
                    focusTaskId: taskIdentity?.taskId || '',
                    focusOrderId: taskIdentity?.orderId || '',
                    deadLetterPage: String(requestPayload.deadLetterPage),
                    deadLetterPageSize: String(requestPayload.deadLetterPageSize),
                    deadLetterReason,
                    lockPage: String(requestPayload.lockPage),
                    lockPageSize: String(requestPayload.lockPageSize),
                    lockState,
                    replayPage: String(requestPayload.replayPage),
                    replayPageSize: String(requestPayload.replayPageSize)
                });
                const response = await fetch(this.buildAdminShopUrl('shop/delivery-tasks', Object.fromEntries(params.entries())), {
                    method: 'GET',
                    headers
                });

                result = await response.json().catch(() => ({}));
                if (!response.ok || !result.success) {
                    throw new Error(result.message || '履约任务加载失败');
                }
            }

            this.renderDeliveryTaskSummary(result.summary || {});
            this.renderDeliveryTaskFilterHint();
            this.renderDeliveryIssueSummary(result.summary || {});
            this.renderDeliveryTasks(result.tasks || [], result.total || 0, result.page || page, result.pageSize || this.deliveryTaskPageSize);
            if (this.deliveryPendingTaskReveal?.taskId || this.deliveryPendingTaskReveal?.orderId) {
                window.requestAnimationFrame(() => this.revealFocusedDeliveryTaskRow());
            }

            const deadLetter = result.deadLetter || {};
            this.renderDeliveryDeadLetterSummary(deadLetter);
            this.renderDeadLetterTasks(
                deadLetter.tasks || [],
                deadLetter.total || 0,
                deadLetter.page || this.deliveryDeadLetterPage,
                deadLetter.pageSize || this.deliveryDeadLetterPageSize
            );

            const lockConflicts = result.lockConflicts || {};
            this.renderLockConflictSummary(lockConflicts);
            this.renderLockConflictTasks(
                lockConflicts.tasks || [],
                lockConflicts.total || 0,
                lockConflicts.page || this.deliveryLockConflictPage,
                lockConflicts.pageSize || this.deliveryLockConflictPageSize
            );

            const reservations = result.reservations || {};
            this.renderReservationSummary(reservations);
            this.renderReservationTasks(reservations.tasks || []);

            this.renderDeliveryConflictAnalytics(result.analytics || {});

            const replay = result.replay || {};
            this.renderReplaySummary(replay);
            this.renderReplayRecords(
                replay.records || [],
                replay.total || 0,
                replay.page || this.deliveryReplayPage,
                replay.pageSize || this.deliveryReplayPageSize
            );

            const conflicts = result.conflicts || {};
            const conflictFilters = conflicts.filters || {};
            this.deliveryConflictAuditReasonFilter = this.normalizeDeliveryConflictAuditReasonFilter(conflictFilters.reason || this.deliveryConflictAuditReasonFilter);
            this.deliveryConflictAuditTargetFilter = String(conflictFilters.target_query || this.deliveryConflictAuditTargetFilter || '').trim();
            this.deliveryConflictAuditChannelFilter = String(conflictFilters.channel_query || this.deliveryConflictAuditChannelFilter || '').trim();
            if (conflictAuditReasonFilter && conflictAuditReasonFilter.value !== this.deliveryConflictAuditReasonFilter) conflictAuditReasonFilter.value = this.deliveryConflictAuditReasonFilter;
            if (conflictAuditTargetInput && conflictAuditTargetInput.value !== this.deliveryConflictAuditTargetFilter) conflictAuditTargetInput.value = this.deliveryConflictAuditTargetFilter;
            if (conflictAuditChannelInput && conflictAuditChannelInput.value !== this.deliveryConflictAuditChannelFilter) conflictAuditChannelInput.value = this.deliveryConflictAuditChannelFilter;
            this.syncShopUrlState();
            this.deliveryConflictAuditRecords = conflicts.records || [];
            this.renderConflictAuditSummary(conflicts);
            this.renderConflictAudits(conflicts.records || []);
            if (this.deliveryPendingAuditReveal?.auditId) {
                window.requestAnimationFrame(() => this.revealFocusedDeliveryConflictAuditRow());
            }
            if (this.deliveryPendingSectionReveal) {
                window.requestAnimationFrame(() => this.revealPendingDeliverySection());
            }

            await strategyPromise;
            if (Number(this.shopTabLoadGeneration.fulfillment || 0) === loadGeneration) {
                this.shopTabLoadState.fulfillment = 'loaded';
            }
        } catch (err) {
            console.error('[ShopAdmin] loadDeliveryTasks failed:', err);
            if (Number(this.shopTabLoadGeneration.fulfillment || 0) === loadGeneration) {
                this.shopTabLoadState.fulfillment = 'error';
            }
            this.deliveryConflictAuditRecords = [];
            if (summary) {
                summary.innerHTML = '<span class="shop-delivery-pill shop-delivery-pill--danger">履约任务加载失败</span>';
            }
            const deliveryIssueSummary = document.getElementById('deliveryIssueSummary');
            if (deliveryIssueSummary) {
                deliveryIssueSummary.innerHTML = '';
                deliveryIssueSummary.hidden = true;
            }
            this.deliveryPendingSectionReveal = '';
            if (tbody) {
                tbody.innerHTML = `<tr><td colspan="8"><div class="shop-delivery-empty">履约任务加载失败：${this.escapeHtml(err.message || '未知错误')}</div></td></tr>`;
            }
            if (deadLetterBody) {
                deadLetterBody.innerHTML = `<tr><td colspan="6"><div class="shop-delivery-empty">死信列表加载失败：${this.escapeHtml(err.message || '未知错误')}</div></td></tr>`;
            }
            if (lockBody) {
                lockBody.innerHTML = `<tr><td colspan="6"><div class="shop-delivery-empty">锁冲突列表加载失败：${this.escapeHtml(err.message || '未知错误')}</div></td></tr>`;
            }
            if (reservationBody) {
                reservationBody.innerHTML = `<tr><td colspan="6"><div class="shop-delivery-empty">全局占位观测加载失败：${this.escapeHtml(err.message || '未知错误')}</div></td></tr>`;
            }
            if (replayBody) {
                replayBody.innerHTML = `<tr><td colspan="6"><div class="shop-delivery-empty">人工重放记录加载失败：${this.escapeHtml(err.message || '未知错误')}</div></td></tr>`;
            }
            if (conflictAuditBody) {
                conflictAuditBody.innerHTML = `<tr><td colspan="5"><div class="shop-delivery-empty">冲突审计加载失败：${this.escapeHtml(err.message || '未知错误')}</div></td></tr>`;
            }
            if (conflictTrendChart) {
                conflictTrendChart.innerHTML = `<div class="shop-delivery-empty">冲突趋势加载失败：${this.escapeHtml(err.message || '未知错误')}</div>`;
            }
            if (conflictTrendLegend) {
                conflictTrendLegend.innerHTML = '';
            }
            if (targetHotspots) {
                targetHotspots.innerHTML = `<div class="shop-delivery-empty">目标热点加载失败：${this.escapeHtml(err.message || '未知错误')}</div>`;
            }
            if (channelHotspots) {
                channelHotspots.innerHTML = `<div class="shop-delivery-empty">通道热点加载失败：${this.escapeHtml(err.message || '未知错误')}</div>`;
            }
            if (conflictAnalyticsSummary) {
                conflictAnalyticsSummary.classList.add('shop-delivery-subcard-meta--rich');
                conflictAnalyticsSummary.innerHTML = this.renderDeliveryMetaBadge('加载失败', 'danger');
            }
            if (deadLetterSummary) {
                deadLetterSummary.classList.add('shop-delivery-subcard-meta--rich');
                deadLetterSummary.innerHTML = this.renderDeliveryMetaBadge('加载失败', 'danger');
            }
            if (lockSummary) {
                lockSummary.classList.add('shop-delivery-subcard-meta--rich');
                lockSummary.innerHTML = this.renderDeliveryMetaBadge('加载失败', 'danger');
            }
            if (reservationSummary) {
                reservationSummary.classList.add('shop-delivery-subcard-meta--rich');
                reservationSummary.innerHTML = this.renderDeliveryMetaBadge('加载失败', 'danger');
            }
            if (replaySummary) {
                replaySummary.classList.add('shop-delivery-subcard-meta--rich');
                replaySummary.innerHTML = this.renderDeliveryMetaBadge('加载失败', 'danger');
            }
            if (conflictAuditSummary) {
                conflictAuditSummary.classList.add('shop-delivery-subcard-meta--rich');
                conflictAuditSummary.innerHTML = this.renderDeliveryMetaBadge('加载失败', 'danger');
            }
            const taskPagination = document.getElementById('deliveryTasksPagination');
            const deadPagination = document.getElementById('deliveryDeadLetterPagination');
            const lockPagination = document.getElementById('deliveryLockConflictsPagination');
            const replayPagination = document.getElementById('deliveryReplayPagination');
            if (taskPagination) taskPagination.innerHTML = '';
            if (deadPagination) deadPagination.innerHTML = '';
            if (lockPagination) lockPagination.innerHTML = '';
            if (replayPagination) replayPagination.innerHTML = '';
        }
    },

    loadDeliveryDeadLetterPage: function (page = 1) {
        this.deliveryDeadLetterPage = page;
        return this.loadDeliveryTasks(this.deliveryTaskPage || 1);
    },

    loadDeliveryLockConflictPage: function (page = 1) {
        this.deliveryLockConflictPage = page;
        return this.loadDeliveryTasks(this.deliveryTaskPage || 1);
    },

    loadDeliveryReplayPage: function (page = 1) {
        this.deliveryReplayPage = page;
        return this.loadDeliveryTasks(this.deliveryTaskPage || 1);
    },

    setDeliveryAnalyticsWindow: function (windowKey) {
        this.deliveryAnalyticsWindow = this.getDeliveryAnalyticsWindowConfig(windowKey).key;
        this.deliveryConflictBucketFilter = null;
        this.deliveryTaskIdentityFilter = null;
        this.deliveryConflictAuditSelection = null;
        this.deliveryPendingTaskReveal = null;
        this.deliveryPendingAuditReveal = null;
        this.deliveryTaskPage = 1;
        this.deliveryDeadLetterPage = 1;
        this.deliveryLockConflictPage = 1;
        this.loadDeliveryTasks(this.deliveryTaskPage || 1);
    },

    toggleDeliveryConflictBucketFilter: function (encodedStartAt, encodedEndAt, encodedLabel) {
        const startAt = decodeURIComponent(String(encodedStartAt || ''));
        const endAt = decodeURIComponent(String(encodedEndAt || ''));
        const label = decodeURIComponent(String(encodedLabel || ''));
        if (!startAt || !endAt) return;

        const current = this.deliveryConflictBucketFilter || {};
        const isSameBucket = current.startAt === startAt && current.endAt === endAt;
        this.deliveryConflictBucketFilter = isSameBucket
            ? null
            : {
                startAt,
                endAt,
                label
            };
        this.deliveryTaskIdentityFilter = null;
        this.deliveryConflictAuditSelection = null;
        this.deliveryPendingTaskReveal = null;
        this.deliveryPendingAuditReveal = null;
        this.deliveryTaskPage = 1;
        this.deliveryDeadLetterPage = 1;
        this.deliveryLockConflictPage = 1;
        this.loadDeliveryTasks(1);
    },

    toggleDeliveryConflictDeadLetterBucketFocus: function (encodedStartAt, encodedEndAt, encodedLabel) {
        const startAt = decodeURIComponent(String(encodedStartAt || ''));
        const endAt = decodeURIComponent(String(encodedEndAt || ''));
        const label = decodeURIComponent(String(encodedLabel || ''));
        if (!startAt || !endAt) return;

        const isSameBucket = this.isDeliveryConflictBucketActive(startAt, endAt);
        const isActive = isSameBucket && this.isDeliveryConflictDeadLetterFocusActive();
        this.deliveryConflictBucketFilter = isActive
            ? null
            : {
                startAt,
                endAt,
                label
            };
        this.deliveryTaskStatusFilter = isActive ? 'all' : 'dead_letter';
        this.deliveryDeadLetterReasonFilter = isActive ? 'all' : 'conflict_strategy';
        this.deliveryTaskIdentityFilter = null;
        this.deliveryConflictAuditSelection = null;
        this.deliveryPendingTaskReveal = null;
        this.deliveryPendingAuditReveal = null;
        const taskFilter = document.getElementById('deliveryTaskStatusFilter');
        const deadLetterReasonFilter = document.getElementById('deliveryDeadLetterReasonFilter');
        if (taskFilter) taskFilter.value = this.deliveryTaskStatusFilter;
        if (deadLetterReasonFilter) deadLetterReasonFilter.value = this.deliveryDeadLetterReasonFilter;
        this.deliveryTaskPage = 1;
        this.deliveryDeadLetterPage = 1;
        this.deliveryLockConflictPage = 1;
        this.deliveryReplayPage = 1;
        this.loadDeliveryTasks(1);
    },

    clearDeliveryConflictBucketFilter: function () {
        this.deliveryConflictBucketFilter = null;
        this.deliveryTaskIdentityFilter = null;
        this.deliveryConflictAuditSelection = null;
        this.deliveryPendingTaskReveal = null;
        this.deliveryPendingAuditReveal = null;
        this.deliveryTaskPage = 1;
        this.deliveryDeadLetterPage = 1;
        this.deliveryLockConflictPage = 1;
        this.loadDeliveryTasks(1);
    },

    toggleDeliveryConflictAuditSelection: function (encodedAuditId, encodedCreatedAt, encodedTaskId, encodedOrderId, encodedTargetKey, encodedChannelKey, encodedReasonKey, encodedScope) {
        const auditId = decodeURIComponent(String(encodedAuditId || ''));
        const createdAt = decodeURIComponent(String(encodedCreatedAt || ''));
        const taskId = decodeURIComponent(String(encodedTaskId || ''));
        const orderId = decodeURIComponent(String(encodedOrderId || ''));
        const targetKey = decodeURIComponent(String(encodedTargetKey || ''));
        const channelKey = decodeURIComponent(String(encodedChannelKey || ''));
        const reasonKey = decodeURIComponent(String(encodedReasonKey || ''));
        const scope = decodeURIComponent(String(encodedScope || ''));
        if (!auditId) return;

        const current = this.deliveryConflictAuditSelection || {};
        if (current.auditId === auditId) {
            this.clearDeliveryConflictAuditSelection();
            return;
        }

        const nextWindowKey = this.resolveDeliveryAnalyticsWindowForTimestamp(createdAt);
        const nextBucket = this.buildDeliveryConflictBucketForTimestamp(createdAt, nextWindowKey);
        const queryContext = this.getDeliveryConflictAuditQueryContext({
            scope,
            reason_key: reasonKey,
            target_key: targetKey,
            channel_key: channelKey
        });

        this.deliveryAnalyticsWindow = nextWindowKey;
        this.deliveryConflictBucketFilter = nextBucket;
        this.deliveryTaskIdentityFilter = {
            taskId: taskId || '',
            orderId: orderId || ''
        };
        this.deliveryConflictAuditSelection = {
            auditId,
            taskId: taskId || '',
            orderId: orderId || '',
            createdAt
        };
        this.deliveryPendingTaskReveal = {
            taskId: taskId || '',
            orderId: orderId || ''
        };
        this.deliveryPendingAuditReveal = {
            auditId
        };
        this.deliveryTaskQuery = String(queryContext.query || '').trim();
        this.deliveryTaskQueryContext = this.deliveryTaskQuery
            ? {
                type: queryContext.type || 'manual',
                label: this.deliveryTaskQuery
            }
            : null;
        this.deliveryTaskStatusFilter = 'all';
        this.deliveryDeadLetterReasonFilter = 'all';
        this.deliveryLockStateFilter = 'all';
        this.deliveryTaskPage = 1;
        this.deliveryDeadLetterPage = 1;
        this.deliveryLockConflictPage = 1;
        this.loadDeliveryTasks(1);
    },

    clearDeliveryConflictAuditSelection: function () {
        this.deliveryTaskIdentityFilter = null;
        this.deliveryConflictAuditSelection = null;
        this.deliveryPendingTaskReveal = null;
        this.deliveryPendingAuditReveal = null;
        this.deliveryTaskPage = 1;
        this.deliveryDeadLetterPage = 1;
        this.deliveryLockConflictPage = 1;
        this.loadDeliveryTasks(1);
    },

    handleDeliveryConflictAuditFilterKeydown: function (event) {
        if (event?.key !== 'Enter') return;
        event.preventDefault();
        this.applyDeliveryConflictAuditFilters();
    },

    applyDeliveryConflictAuditFilters: function () {
        const reasonSelect = document.getElementById('deliveryConflictAuditReasonFilter');
        const targetInput = document.getElementById('deliveryConflictAuditTargetFilter');
        const channelInput = document.getElementById('deliveryConflictAuditChannelFilter');

        this.deliveryConflictAuditReasonFilter = this.normalizeDeliveryConflictAuditReasonFilter(reasonSelect?.value || this.deliveryConflictAuditReasonFilter || 'all');
        this.deliveryConflictAuditTargetFilter = String(targetInput?.value || '').trim();
        this.deliveryConflictAuditChannelFilter = String(channelInput?.value || '').trim();
        this.deliveryPendingAuditReveal = null;
        this.loadDeliveryTasks(this.deliveryTaskPage || 1);
    },

    applyDeliveryConflictAuditReasonQuickFilter: function (encodedReasonKey) {
        const nextReasonKey = this.normalizeDeliveryConflictAuditReasonFilter(decodeURIComponent(String(encodedReasonKey || '')));
        const currentReasonKey = this.normalizeDeliveryConflictAuditReasonFilter(this.deliveryConflictAuditReasonFilter || 'all');
        this.deliveryConflictAuditReasonFilter = currentReasonKey === nextReasonKey ? 'all' : nextReasonKey;
        const reasonSelect = document.getElementById('deliveryConflictAuditReasonFilter');
        if (reasonSelect) reasonSelect.value = this.deliveryConflictAuditReasonFilter;
        this.deliveryPendingAuditReveal = null;
        this.loadDeliveryTasks(this.deliveryTaskPage || 1);
    },

    applyDeliveryConflictAuditTargetQuickFilter: function (encodedTargetKey) {
        const nextTargetKey = decodeURIComponent(String(encodedTargetKey || '')).trim();
        this.deliveryConflictAuditTargetFilter = this.deliveryConflictAuditTargetFilter === nextTargetKey ? '' : nextTargetKey;
        const targetInput = document.getElementById('deliveryConflictAuditTargetFilter');
        if (targetInput) targetInput.value = this.deliveryConflictAuditTargetFilter;
        this.deliveryPendingAuditReveal = null;
        this.loadDeliveryTasks(this.deliveryTaskPage || 1);
    },

    applyDeliveryConflictAuditChannelQuickFilter: function (encodedChannelKey) {
        const nextChannelKey = decodeURIComponent(String(encodedChannelKey || '')).trim();
        this.deliveryConflictAuditChannelFilter = this.deliveryConflictAuditChannelFilter === nextChannelKey ? '' : nextChannelKey;
        const channelInput = document.getElementById('deliveryConflictAuditChannelFilter');
        if (channelInput) channelInput.value = this.deliveryConflictAuditChannelFilter;
        this.deliveryPendingAuditReveal = null;
        this.loadDeliveryTasks(this.deliveryTaskPage || 1);
    },

    clearDeliveryConflictAuditReasonFilter: function () {
        this.deliveryConflictAuditReasonFilter = 'all';
        const reasonSelect = document.getElementById('deliveryConflictAuditReasonFilter');
        if (reasonSelect) reasonSelect.value = 'all';
        this.deliveryPendingAuditReveal = null;
        this.loadDeliveryTasks(this.deliveryTaskPage || 1);
    },

    clearDeliveryConflictAuditTargetFilter: function () {
        this.deliveryConflictAuditTargetFilter = '';
        const targetInput = document.getElementById('deliveryConflictAuditTargetFilter');
        if (targetInput) targetInput.value = '';
        this.deliveryPendingAuditReveal = null;
        this.loadDeliveryTasks(this.deliveryTaskPage || 1);
    },

    clearDeliveryConflictAuditChannelFilter: function () {
        this.deliveryConflictAuditChannelFilter = '';
        const channelInput = document.getElementById('deliveryConflictAuditChannelFilter');
        if (channelInput) channelInput.value = '';
        this.deliveryPendingAuditReveal = null;
        this.loadDeliveryTasks(this.deliveryTaskPage || 1);
    },

    toggleDeliveryConflictDeadLetterFocus: function () {
        const nextActive = !this.isDeliveryConflictDeadLetterFocusActive();
        this.deliveryTaskStatusFilter = nextActive ? 'dead_letter' : 'all';
        this.deliveryDeadLetterReasonFilter = nextActive ? 'conflict_strategy' : 'all';
        this.deliveryTaskIdentityFilter = null;
        this.deliveryConflictAuditSelection = null;
        this.deliveryPendingTaskReveal = null;
        this.deliveryPendingAuditReveal = null;
        const taskFilter = document.getElementById('deliveryTaskStatusFilter');
        const deadLetterReasonFilter = document.getElementById('deliveryDeadLetterReasonFilter');
        if (taskFilter) taskFilter.value = this.deliveryTaskStatusFilter;
        if (deadLetterReasonFilter) deadLetterReasonFilter.value = this.deliveryDeadLetterReasonFilter;
        this.deliveryTaskPage = 1;
        this.deliveryDeadLetterPage = 1;
        this.deliveryLockConflictPage = 1;
        this.deliveryReplayPage = 1;
        this.loadDeliveryTasks(1);
    },

    clearDeliveryConflictDeadLetterFocus: function () {
        this.deliveryTaskStatusFilter = 'all';
        this.deliveryDeadLetterReasonFilter = 'all';
        const taskFilter = document.getElementById('deliveryTaskStatusFilter');
        const deadLetterReasonFilter = document.getElementById('deliveryDeadLetterReasonFilter');
        if (taskFilter) taskFilter.value = 'all';
        if (deadLetterReasonFilter) deadLetterReasonFilter.value = 'all';
        this.deliveryTaskPage = 1;
        this.deliveryDeadLetterPage = 1;
        this.deliveryLockConflictPage = 1;
        this.deliveryReplayPage = 1;
        this.loadDeliveryTasks(1);
    },

    clearDeliveryConflictAuditFilters: function () {
        const reasonSelect = document.getElementById('deliveryConflictAuditReasonFilter');
        const targetInput = document.getElementById('deliveryConflictAuditTargetFilter');
        const channelInput = document.getElementById('deliveryConflictAuditChannelFilter');

        this.deliveryConflictAuditReasonFilter = 'all';
        this.deliveryConflictAuditTargetFilter = '';
        this.deliveryConflictAuditChannelFilter = '';
        this.deliveryPendingAuditReveal = null;
        if (reasonSelect) reasonSelect.value = 'all';
        if (targetInput) targetInput.value = '';
        if (channelInput) channelInput.value = '';
        this.loadDeliveryTasks(this.deliveryTaskPage || 1);
    },

    handleDeliveryTaskQueryKeydown: function (event) {
        if (event?.key !== 'Enter') return;
        event.preventDefault();
        this.applyDeliveryTaskQuery();
    },

    applyDeliveryTaskQuery: function () {
        const input = document.getElementById('deliveryTaskQueryInput');
        const nextQuery = String(input?.value || '').trim();
        this.deliveryTaskQuery = nextQuery;
        this.deliveryTaskQueryContext = nextQuery
            ? {
                type: 'manual',
                label: nextQuery
            }
            : null;
        this.deliveryTaskIdentityFilter = null;
        this.deliveryConflictAuditSelection = null;
        this.deliveryPendingTaskReveal = null;
        this.deliveryPendingAuditReveal = null;
        this.deliveryTaskPage = 1;
        this.deliveryDeadLetterPage = 1;
        this.deliveryLockConflictPage = 1;
        this.loadDeliveryTasks(1);
    },

    applyDeliveryHotspotFilter: function (type, encodedKey) {
        const decodedKey = decodeURIComponent(String(encodedKey || ''));
        const nextQuery = decodedKey.trim();
        if (!nextQuery) return;

        this.deliveryTaskQuery = nextQuery;
        this.deliveryTaskQueryContext = {
            type: type === 'channel' ? 'channel' : 'target',
            label: nextQuery
        };
        this.deliveryTaskIdentityFilter = null;
        this.deliveryConflictAuditSelection = null;
        this.deliveryPendingTaskReveal = null;
        this.deliveryPendingAuditReveal = null;
        this.deliveryTaskPage = 1;
        this.deliveryDeadLetterPage = 1;
        this.deliveryLockConflictPage = 1;
        this.loadDeliveryTasks(1);
    },

    applyDeliveryHotspotMetricDrilldown: function (type, encodedKey, metricKind = 'manual') {
        const decodedKey = decodeURIComponent(String(encodedKey || ''));
        const nextQuery = decodedKey.trim();
        if (!nextQuery) return;

        const normalizedType = type === 'channel' ? 'channel' : 'target';
        const normalizedMetric = String(metricKind || '').trim().toLowerCase();
        const isSameHotspot = this.isDeliveryHotspotQueryActive(normalizedType, nextQuery);
        const isManualActive = isSameHotspot && this.normalizeDeliveryConflictAuditReasonFilter(this.deliveryConflictAuditReasonFilter) === 'manual_force_unlock';
        const isDeadLetterActive = isSameHotspot && this.isDeliveryConflictDeadLetterFocusActive();

        this.deliveryTaskQuery = nextQuery;
        this.deliveryTaskQueryContext = {
            type: normalizedType,
            label: nextQuery
        };
        this.deliveryTaskIdentityFilter = null;
        this.deliveryConflictAuditSelection = null;
        this.deliveryPendingTaskReveal = null;
        this.deliveryPendingAuditReveal = null;

        const taskFilter = document.getElementById('deliveryTaskStatusFilter');
        const deadLetterReasonFilter = document.getElementById('deliveryDeadLetterReasonFilter');
        const conflictAuditReasonFilter = document.getElementById('deliveryConflictAuditReasonFilter');

        if (normalizedMetric === 'dead_letter') {
            const nextActive = !isDeadLetterActive;
            this.deliveryTaskStatusFilter = nextActive ? 'dead_letter' : 'all';
            this.deliveryDeadLetterReasonFilter = nextActive ? 'conflict_strategy' : 'all';
            this.deliveryConflictAuditReasonFilter = 'all';
        } else {
            const nextActive = !isManualActive;
            this.deliveryConflictAuditReasonFilter = nextActive ? 'manual_force_unlock' : 'all';
            this.deliveryTaskStatusFilter = 'all';
            this.deliveryDeadLetterReasonFilter = 'all';
        }

        if (taskFilter) taskFilter.value = this.deliveryTaskStatusFilter;
        if (deadLetterReasonFilter) deadLetterReasonFilter.value = this.deliveryDeadLetterReasonFilter;
        if (conflictAuditReasonFilter) conflictAuditReasonFilter.value = this.deliveryConflictAuditReasonFilter;

        this.deliveryTaskPage = 1;
        this.deliveryDeadLetterPage = 1;
        this.deliveryLockConflictPage = 1;
        this.deliveryReplayPage = 1;
        this.loadDeliveryTasks(1);
    },

    applyDeliveryHotspotReasonDrilldown: function (type, encodedKey, encodedReasonKey) {
        const decodedKey = decodeURIComponent(String(encodedKey || ''));
        const nextQuery = decodedKey.trim();
        const nextReason = this.normalizeDeliveryConflictAuditReasonFilter(decodeURIComponent(String(encodedReasonKey || '')));
        if (!nextQuery || nextReason === 'all') return;

        const normalizedType = type === 'channel' ? 'channel' : 'target';
        const isSameHotspot = this.isDeliveryHotspotQueryActive(normalizedType, nextQuery);
        const isSameReasonActive = isSameHotspot && this.normalizeDeliveryConflictAuditReasonFilter(this.deliveryConflictAuditReasonFilter) === nextReason;

        this.deliveryTaskQuery = nextQuery;
        this.deliveryTaskQueryContext = {
            type: normalizedType,
            label: nextQuery
        };
        this.deliveryTaskIdentityFilter = null;
        this.deliveryConflictAuditSelection = null;
        this.deliveryPendingTaskReveal = null;
        this.deliveryPendingAuditReveal = null;
        this.deliveryConflictAuditReasonFilter = isSameReasonActive ? 'all' : nextReason;
        this.deliveryTaskStatusFilter = 'all';
        this.deliveryDeadLetterReasonFilter = 'all';

        const taskFilter = document.getElementById('deliveryTaskStatusFilter');
        const deadLetterReasonFilter = document.getElementById('deliveryDeadLetterReasonFilter');
        const conflictAuditReasonFilter = document.getElementById('deliveryConflictAuditReasonFilter');
        if (taskFilter) taskFilter.value = this.deliveryTaskStatusFilter;
        if (deadLetterReasonFilter) deadLetterReasonFilter.value = this.deliveryDeadLetterReasonFilter;
        if (conflictAuditReasonFilter) conflictAuditReasonFilter.value = this.deliveryConflictAuditReasonFilter;

        this.deliveryTaskPage = 1;
        this.deliveryDeadLetterPage = 1;
        this.deliveryLockConflictPage = 1;
        this.deliveryReplayPage = 1;
        this.loadDeliveryTasks(1);
    },

    clearDeliveryTaskQuery: function () {
        this.deliveryTaskQuery = '';
        this.deliveryTaskQueryContext = null;
        this.deliveryTaskIdentityFilter = null;
        this.deliveryConflictAuditSelection = null;
        this.deliveryPendingTaskReveal = null;
        this.deliveryPendingAuditReveal = null;
        const input = document.getElementById('deliveryTaskQueryInput');
        if (input) {
            input.value = '';
        }
        this.deliveryTaskPage = 1;
        this.deliveryDeadLetterPage = 1;
        this.deliveryLockConflictPage = 1;
        this.loadDeliveryTasks(1);
    },

    clearAllDeliveryFilterBreadcrumbs: function () {
        this.deliveryTaskQuery = '';
        this.deliveryTaskQueryContext = null;
        this.deliveryConflictBucketFilter = null;
        this.deliveryTaskIdentityFilter = null;
        this.deliveryConflictAuditSelection = null;
        this.deliveryConflictAuditReasonFilter = 'all';
        this.deliveryConflictAuditTargetFilter = '';
        this.deliveryConflictAuditChannelFilter = '';
        this.deliveryTaskStatusFilter = 'all';
        this.deliveryDeadLetterReasonFilter = 'all';
        this.deliveryLockStateFilter = 'all';
        this.deliveryPendingTaskReveal = null;
        this.deliveryPendingAuditReveal = null;

        const taskQueryInput = document.getElementById('deliveryTaskQueryInput');
        const taskFilter = document.getElementById('deliveryTaskStatusFilter');
        const deadLetterReasonFilter = document.getElementById('deliveryDeadLetterReasonFilter');
        const lockStateFilter = document.getElementById('deliveryLockStateFilter');
        const conflictAuditReasonFilter = document.getElementById('deliveryConflictAuditReasonFilter');
        const conflictAuditTargetInput = document.getElementById('deliveryConflictAuditTargetFilter');
        const conflictAuditChannelInput = document.getElementById('deliveryConflictAuditChannelFilter');
        if (taskQueryInput) taskQueryInput.value = '';
        if (taskFilter) taskFilter.value = 'all';
        if (deadLetterReasonFilter) deadLetterReasonFilter.value = 'all';
        if (lockStateFilter) lockStateFilter.value = 'all';
        if (conflictAuditReasonFilter) conflictAuditReasonFilter.value = 'all';
        if (conflictAuditTargetInput) conflictAuditTargetInput.value = '';
        if (conflictAuditChannelInput) conflictAuditChannelInput.value = '';

        this.deliveryTaskPage = 1;
        this.deliveryDeadLetterPage = 1;
        this.deliveryLockConflictPage = 1;
        this.deliveryReplayPage = 1;
        this.loadDeliveryTasks(1);
    },

    setDeliveryTaskStatusFilter: function (status) {
        this.deliveryTaskStatusFilter = status || 'all';
        const taskFilter = document.getElementById('deliveryTaskStatusFilter');
        if (taskFilter) taskFilter.value = this.deliveryTaskStatusFilter;
        this.deliveryTaskPage = 1;
        this.deliveryDeadLetterPage = 1;
        this.deliveryLockConflictPage = 1;
        this.deliveryReplayPage = 1;
        this.loadDeliveryTasks(1);
    },

    clearDeliveryTaskStatusFilter: function () {
        this.setDeliveryTaskStatusFilter('all');
    },

    applyDeliveryIssueSummaryFocus: function (focusKind, rawValue) {
        const kind = String(focusKind || 'status').trim().toLowerCase();
        const value = String(rawValue || 'all').trim().toLowerCase() || 'all';
        const taskFilter = document.getElementById('deliveryTaskStatusFilter');
        const deadLetterReasonFilter = document.getElementById('deliveryDeadLetterReasonFilter');
        const lockStateFilter = document.getElementById('deliveryLockStateFilter');

        if (kind === 'lock') {
            const nextLockState = String(this.deliveryLockStateFilter || 'all').trim().toLowerCase() === value ? 'all' : value;
            this.deliveryTaskStatusFilter = 'all';
            this.deliveryDeadLetterReasonFilter = 'all';
            this.deliveryLockStateFilter = nextLockState;
            this.deliveryTaskPage = 1;
            this.deliveryDeadLetterPage = 1;
            this.deliveryLockConflictPage = 1;
            this.deliveryReplayPage = 1;
            if (taskFilter) taskFilter.value = 'all';
            if (deadLetterReasonFilter) deadLetterReasonFilter.value = 'all';
            if (lockStateFilter) lockStateFilter.value = nextLockState;
            this.loadDeliveryTasks(1);
            if (nextLockState !== 'all') {
                window.requestAnimationFrame(() => {
                    document.getElementById('deliveryLockConflictSummary')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                });
            }
            return;
        }

        const nextStatus = String(this.deliveryTaskStatusFilter || 'all').trim().toLowerCase() === value ? 'all' : value;
        this.deliveryTaskStatusFilter = nextStatus;
        this.deliveryDeadLetterReasonFilter = 'all';
        this.deliveryLockStateFilter = 'all';
        this.deliveryTaskPage = 1;
        this.deliveryDeadLetterPage = 1;
        this.deliveryLockConflictPage = 1;
        this.deliveryReplayPage = 1;
        if (taskFilter) taskFilter.value = nextStatus;
        if (deadLetterReasonFilter) deadLetterReasonFilter.value = 'all';
        if (lockStateFilter) lockStateFilter.value = 'all';
        this.loadDeliveryTasks(1);
    },

    applyDeliveryPriorityAction: function (rawKey) {
        const key = String(rawKey || '').trim().toLowerCase();
        if (!key) return;

        if (key === 'force_unlock') {
            this.deliveryPendingSectionReveal = 'lock_conflicts';
            this.applyDeliveryIssueSummaryFocus('lock', 'stale');
            return;
        }

        if (['dead_letter', 'retry_waiting', 'processing', 'pending'].includes(key)) {
            this.deliveryPendingSectionReveal = key === 'dead_letter' ? 'dead_letter' : 'tasks';
            this.applyDeliveryIssueSummaryFocus('status', key);
        }
    },

    setDeliveryDeadLetterReasonFilter: function (reason) {
        this.deliveryDeadLetterReasonFilter = reason || 'all';
        const deadLetterReasonFilter = document.getElementById('deliveryDeadLetterReasonFilter');
        if (deadLetterReasonFilter) deadLetterReasonFilter.value = this.deliveryDeadLetterReasonFilter;
        this.deliveryDeadLetterPage = 1;
        this.loadDeliveryTasks(this.deliveryTaskPage || 1);
    },

    clearDeliveryDeadLetterReasonFilter: function () {
        this.deliveryDeadLetterReasonFilter = 'all';
        const deadLetterReasonFilter = document.getElementById('deliveryDeadLetterReasonFilter');
        if (deadLetterReasonFilter) deadLetterReasonFilter.value = 'all';
        this.deliveryDeadLetterPage = 1;
        this.loadDeliveryTasks(this.deliveryTaskPage || 1);
    },

    setDeliveryLockStateFilter: function (lockState) {
        this.deliveryLockStateFilter = lockState || 'all';
        const lockStateFilter = document.getElementById('deliveryLockStateFilter');
        if (lockStateFilter) lockStateFilter.value = this.deliveryLockStateFilter;
        this.deliveryLockConflictPage = 1;
        this.loadDeliveryTasks(this.deliveryTaskPage || 1);
    },

    clearDeliveryLockStateFilter: function () {
        this.deliveryLockStateFilter = 'all';
        const lockStateFilter = document.getElementById('deliveryLockStateFilter');
        if (lockStateFilter) lockStateFilter.value = 'all';
        this.deliveryLockConflictPage = 1;
        this.loadDeliveryTasks(this.deliveryTaskPage || 1);
    },

    performDeliveryTaskAction: async function (taskId, action) {
        const actionMap = {
            requeue: '将任务重排队',
            replay: '立即人工重放',
            mark_dead_letter: '将任务标记为死信',
            mark_delivered: '将任务标记为已履约',
            force_unlock: '将任务强制解锁'
        };
        const notePromptMap = {
            replay: '可选：填写人工重放备注（例如人工补单、对账确认）',
            mark_dead_letter: '可选：填写死信备注（例如上游永久失败、人工判定不可重试）',
            force_unlock: '可选：填写强制解锁原因（例如锁过期、worker 异常退出）'
        };

        if (!taskId || !action) return;

        let note = '';
        if (Object.prototype.hasOwnProperty.call(notePromptMap, action)) {
            const promptValue = window.prompt(notePromptMap[action], '');
            if (promptValue === null) return;
            note = String(promptValue || '').trim();
        }

        const message = actionMap[action] || '执行该动作';
        if (!confirm(`确认要${message}吗？`)) return;

        try {
            if (this.isDeliveryMockModeEnabled()) {
                const result = await this.performDeliveryMockTaskAction(taskId, action, note);
                alert(result.message || `模拟验收：已完成 ${message}`);
                this.invalidateShopTabCache();
                await this.loadDeliveryTasks(this.deliveryTaskPage || 1);
                return;
            }

            const headers = await this.getAdminAuthHeaders();
            const response = await fetch(this.buildAdminShopUrl('shop/delivery-actions'), {
                method: 'POST',
                headers,
                body: JSON.stringify({ taskId, action, note })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.success) {
                throw new Error(result.message || '履约任务操作失败');
            }

            alert(result.message || `已完成：${message}`);
            this.invalidateShopTabCache();
            if (this.currentTab === 'orders') {
                await this.searchOrders(this.ordersPage || 1);
            } else {
                await this.loadDeliveryTasks(this.deliveryTaskPage || 1);
            }
            if (this.currentOrderDetailId) {
                await this.showOrderContent(this.currentOrderDetailId);
            }
        } catch (err) {
            console.error('[ShopAdmin] performDeliveryTaskAction failed:', err);
            alert(`履约任务操作失败：${err.message || '未知错误'}`);
        }
    },

    searchOrders: async function (page = 1, options = {}) {
        this.ordersPage = page;
        const loadGeneration = Number(this.shopTabLoadGeneration.orders || 0);
        this.shopTabLoadState.orders = 'loading';
        const normalizedOptions = options && typeof options === 'object' ? options : {};
        const orderSearchInput = document.getElementById('orderSearchInput');
        const query = String(
            normalizedOptions.queryOverride !== undefined
                ? normalizedOptions.queryOverride
                : orderSearchInput?.value || ''
        ).trim();
        const tbody = document.getElementById('ordersTableBody');
        const explicitFocusedOrderId = String(normalizedOptions.focusOrderId || '').replace(/^SHOP_ORDER_/i, '').trim();
        const persistedFocusedOrderId = String(this.focusedOrderId || '').replace(/^SHOP_ORDER_/i, '').trim();
        const focusedOrderId = explicitFocusedOrderId
            || (persistedFocusedOrderId && persistedFocusedOrderId === query.replace(/^SHOP_ORDER_/i, '').trim()
                ? persistedFocusedOrderId
                : '');
        const shouldOpenDetails = normalizedOptions.openDetails === true
            || (normalizedOptions.openDetails !== false && this.pendingOpenOrderDetails === true && Boolean(focusedOrderId));
        const requestToken = (this.orderSearchRequestToken || 0) + 1;
        this.orderSearchRequestToken = requestToken;
        this.focusedOrderId = focusedOrderId;
        this.pendingOpenOrderDetails = shouldOpenDetails;
        this.syncOrderFilterControls();

        if (orderSearchInput && orderSearchInput.value !== query) {
            orderSearchInput.value = query;
        }
        if (Object.prototype.hasOwnProperty.call(normalizedOptions, 'context')) {
            this.setOrderSearchContext(normalizedOptions.context);
        } else {
            this.renderOrderSearchContextHint();
            this.renderOrderUserFlowSummary([], { totalCount: 0, loading: false });
        }
        this.renderOrderIssueSummary([], { totalCount: 0 });
        this.renderOrderUserFlowSummary([], {
            totalCount: 0,
            loading: this.hasUserCommerceOrderContext()
        });

        tbody.innerHTML = this.buildShopOrdersLoadingSkeleton(5);

        const limit = this.pageSize;

        try {
            const site = window.AdminSiteFilter?.getSiteFilter?.() || 'all';
            const payload = await this.loadOrdersViaAdminApi({
                site,
                page,
                pageSize: limit,
                query: query || null,
                refundStatus: this.normalizeOrderRefundStatusFilter(this.orderRefundStatusFilter),
                deliveryStatus: this.normalizeOrderDeliveryStatusFilter(this.orderDeliveryStatusFilter)
            });

            const data = Array.isArray(payload?.rows) ? payload.rows : [];
            const count = Number(payload?.count) || 0;

            if (requestToken !== this.orderSearchRequestToken) {
                return { opened: true, matched: false, stale: true };
            }

            this.currentOrderRows = data;
            tbody.innerHTML = '';
            if (!data || data.length === 0) {
                this.currentOrderRows = [];
                if (focusedOrderId) {
                    this.pendingOpenOrderDetails = false;
                }
                const issueFocusLabel = this.orderRefundStatusFilter !== 'all'
                    ? `当前筛选下暂无匹配的退款订单`
                    : (this.orderDeliveryStatusFilter !== 'all'
                        ? `当前筛选下暂无匹配的履约问题订单`
                        : '无数据 - 请检查订单号是否正确');
                tbody.innerHTML = `<tr><td colspan="6" class="text-center">${this.escapeHtml(issueFocusLabel)}</td></tr>`;
                this.renderOrderIssueSummary([], { totalCount: 0 });
                this.renderOrderUserFlowSummary([], { totalCount: 0, loading: false });
                this.renderPagination('ordersPagination', page, count || 0, this.pageSize, 'searchOrders');
                if (Number(this.shopTabLoadGeneration.orders || 0) === loadGeneration) {
                    this.shopTabLoadState.orders = 'loaded';
                }
                return { opened: true, matched: false };
            }

            let matchedFocusedOrder = null;

            for (const order of data) {
                const date = new Date(order.created_at).toLocaleString();
                // Get user info from map
                const user = order.profiles || {};
                const userName = user.username || 'Unknown';
                const userEmail = user.email || order.user_id.substring(0, 8) + '...';
                const userAvatar = user.avatar_url
                    ? user.avatar_url
                    : `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(userName)}&backgroundColor=6b9ece`;
                const safeUserName = this.escapeHtml(userName);
                const safeUserEmail = this.escapeHtml(userEmail);
                const safeUserAvatar = this.escapeHtml(userAvatar);
                const safeOrderUserId = this.escapeHtml(order.user_id || '');
                const safeDate = this.escapeHtml(date);

                // Two-line layout like user management page
                const userDisplay = `
                    <div class="user-cell shop-order-user-cell">
                        <img src="${safeUserAvatar}" class="user-avatar-small shop-order-user-avatar" data-fallback-src="https://api.dicebear.com/7.x/initials/svg?seed=U&backgroundColor=6b9ece">
                        <div class="user-info shop-order-user-info">
                            <div class="user-name shop-order-user-name">${safeUserName}</div>
                            <div class="user-email shop-order-user-email">${safeUserEmail}</div>
                        </div>
                    </div>
                `;

                // Handle new items array structure
                const items = Array.isArray(order.resolved_items) ? order.resolved_items : (order.items || []);
                let productName = 'Unknown';
                let contentData = '';

                if (items.length > 0) {
                    productName = items[0].product_name || 'Unknown';
                    // Encode items array for passing to function
                    contentData = encodeURIComponent(JSON.stringify(items)).replace(/'/g, '%27');
                }

                if (order.item_count > 1) {
                    productName += ` 等 ${order.item_count} 件`;
                }

                const status = this.getOrderDeliveryStatusBadge(order);
                const isFocusedOrder = focusedOrderId && String(order.id || '').trim() === focusedOrderId;
                if (isFocusedOrder) {
                    matchedFocusedOrder = {
                        id: String(order.id || '').trim(),
                        itemsData: contentData
                    };
                }

                tbody.innerHTML += `
                <tr class="shop-order-row${isFocusedOrder ? ' shop-order-row--focused' : ''}" data-shop-action="order-show-content" data-order-id="${this.escapeForAttr(order.id)}" data-items-data="${contentData}" title="点击查看订单详情">
                    <td data-label="用户" title="${safeOrderUserId}">${userDisplay}</td>
                    <td data-label="订单时间">${safeDate}</td>
                    <td data-label="商品">${this.escapeHtml(productName)}</td>
                    <td data-label="支付积分">${order.total_price || order.price_paid}</td>
                    <td data-label="发货状态">${status}</td>
                    <td data-label="操作" data-shop-action="order-actions-stop">
                        ${(order.refund_status !== 'refunded' && order.refund_status !== 'full_refund') ?
                        `<button class="shop-order-action-btn shop-order-action-btn--refund" data-shop-action="order-refund" data-order-id="${this.escapeForAttr(order.id)}" title="退款"><i class="fas fa-undo"></i></button>`
                        : '<span class="shop-order-empty-action">-</span>'}
                    </td>
                </tr>
                `;
            }



            // Render Pagination
            this.renderOrderIssueSummary(data, { totalCount: count || data.length });
            this.renderOrderUserFlowSummary(data, { totalCount: count || data.length, loading: false });
            this.renderPagination('ordersPagination', page, count || 0, this.pageSize, 'searchOrders');

            // Enable horizontal scroll with mouse wheel for mobile
            const ordersTableContainer = document.querySelector('#shop-view-orders .shop-table-container');
            if (ordersTableContainer && window.enableHorizontalScroll) {
                window.enableHorizontalScroll(ordersTableContainer);
            }

            const matched = Boolean(matchedFocusedOrder);
            if (matchedFocusedOrder) {
                window.requestAnimationFrame(() => {
                    this.scrollFocusedOrderIntoView();
                    if (this.pendingOpenOrderDetails && matchedFocusedOrder.itemsData) {
                        this.pendingOpenOrderDetails = false;
                        this.showOrderContent(matchedFocusedOrder.id, matchedFocusedOrder.itemsData);
                    }
                });
            } else if (focusedOrderId) {
                this.pendingOpenOrderDetails = false;
            }

            if (Number(this.shopTabLoadGeneration.orders || 0) === loadGeneration) {
                this.shopTabLoadState.orders = 'loaded';
            }
            return { opened: true, matched };

        } catch (err) {
            if (requestToken !== this.orderSearchRequestToken) {
                return { opened: true, matched: false, stale: true };
            }
            console.error(err);
            this.currentOrderRows = [];
            if (Number(this.shopTabLoadGeneration.orders || 0) === loadGeneration) {
                this.shopTabLoadState.orders = 'error';
            }
            this.renderOrderIssueSummary([], { totalCount: 0 });
            this.renderOrderUserFlowSummary([], { totalCount: 0, loading: false });
            tbody.innerHTML = `<tr><td colspan="6" class="text-danger">Error: ${this.escapeHtml(err.message)}</td></tr>`;
            return { opened: false, matched: false, error: err };
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

    parseOrderItemsData: function (itemsData) {
        if (!itemsData) return [];
        try {
            const parsed = JSON.parse(decodeURIComponent(itemsData));
            return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
        } catch (error) {
            console.error('[ShopAdmin] Failed to parse order items data:', error);
            const fallback = decodeURIComponent(String(itemsData || ''));
            return fallback ? [{ content: fallback }] : [];
        }
    },

    formatOrderDetailTime: function (value) {
        if (!value) return '—';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '—';
        return date.toLocaleString('zh-CN');
    },

    getOrderRefundStatusBadge: function (order = {}) {
        const status = String(order?.refund_status || 'none').trim().toLowerCase();
        if (status === 'refunded' || status === 'full_refund') {
            return this.renderDeliveryBadge('已退款', 'muted');
        }
        if (status === 'pending') {
            return this.renderDeliveryBadge('退款处理中', 'warn');
        }
        return this.renderDeliveryBadge('正常', 'processing');
    },

    getOrderDetailTaskLockState: function (task = {}) {
        if (!task?.lock_token) {
            return String(task?.status || '').trim().toLowerCase() === 'processing'
                ? 'lock_missing'
                : 'unlocked';
        }
        const expiresAt = task?.lock_expires_at ? new Date(task.lock_expires_at).getTime() : 0;
        if (!Number.isFinite(expiresAt) || !expiresAt) {
            return 'locked_unknown';
        }
        return expiresAt > Date.now() ? 'locked_active' : 'locked_stale';
    },

    getOrderTicketIssueLabel: function (issueType) {
        const normalized = String(issueType || '').trim().toUpperCase();
        const labels = {
            DELIVERY: '履约问题',
            VERIFICATION: '验证问题',
            REFUND: '退款问题',
            PAYMENT: '支付问题',
            ORDER: '订单问题',
            ACCOUNT: '账号问题',
            OTHER: '其他问题'
        };
        return labels[normalized] || normalized || '其他问题';
    },

    getOrderTicketStatusBadge: function (status) {
        const normalized = String(status || '').trim().toUpperCase();
        if (normalized === 'RESOLVED') return this.renderDeliveryBadge('已解决', 'success');
        if (normalized === 'REJECTED') return this.renderDeliveryBadge('已拒绝', 'muted');
        return this.renderDeliveryBadge('待处理', 'warn');
    },

    getOrderCaseStatusBadge: function (status) {
        const normalized = String(status || '').trim().toLowerCase();
        if (normalized === 'resolved') return this.renderDeliveryBadge('已收口', 'success');
        if (normalized === 'claimed') return this.renderDeliveryBadge('处理中', 'processing');
        return this.renderDeliveryBadge('待跟进', 'warn');
    },

    buildOrderDetailLoadingMarkup: function (orderId) {
        return `
            <div class="shop-order-content-modal shop-order-detail-modal custom-scrollbar">
                <div class="shop-order-content-header shop-order-detail-header">
                    <div>
                        <div class="shop-order-detail-eyebrow">Order Detail</div>
                        <h3 class="shop-order-content-title">订单详情加载中</h3>
                    </div>
                    <button type="button" class="shop-order-content-close" data-shop-action="order-close-content" data-modal-id="orderContentModal" aria-label="关闭">&times;</button>
                </div>
                <div class="shop-order-content-body shop-order-detail-body">
                    <div class="shop-order-detail-loading">
                        <div class="shop-order-detail-loading__hero"></div>
                        <div class="shop-order-detail-loading__grid">
                            <div class="shop-order-detail-loading__card"></div>
                            <div class="shop-order-detail-loading__card"></div>
                            <div class="shop-order-detail-loading__card"></div>
                        </div>
                        <div class="shop-order-content-meta">订单号：<code class="shop-order-content-order-id">${this.escapeHtml(orderId || '')}</code></div>
                    </div>
                </div>
            </div>
        `;
    },

    buildOrderDetailErrorMarkup: function (message, orderId, fallbackItems = []) {
        const safeOrderId = this.escapeHtml(orderId || '');
        const fallbackContent = (Array.isArray(fallbackItems) ? fallbackItems : []).map((item) => `
            <div class="shop-order-content-item">
                <div class="shop-order-content-item-title">${this.escapeHtml(item.product_name || '商品')}</div>
                <div class="shop-order-content-item-value">${this.escapeHtml(item.content || '无内容')}</div>
            </div>
        `).join('');

        return `
            <div class="shop-order-content-modal shop-order-detail-modal custom-scrollbar">
                <div class="shop-order-content-header shop-order-detail-header">
                    <div>
                        <div class="shop-order-detail-eyebrow">Order Detail</div>
                        <h3 class="shop-order-content-title">订单详情加载失败</h3>
                    </div>
                    <button type="button" class="shop-order-content-close" data-shop-action="order-close-content" data-modal-id="orderContentModal" aria-label="关闭">&times;</button>
                </div>
                <div class="shop-order-content-body shop-order-detail-body">
                    <div class="shop-order-detail-empty">
                        <div class="shop-order-detail-empty__title">暂时拿不到聚合上下文</div>
                        <div class="shop-order-detail-empty__summary">${this.escapeHtml(message || '订单详情加载失败')}</div>
                        <div class="shop-order-content-meta">订单号：<code class="shop-order-content-order-id">${safeOrderId}</code></div>
                        <div class="shop-order-detail-inline-actions">
                            <button type="button" class="shop-order-detail-inline-btn shop-order-detail-inline-btn--primary" data-shop-action="order-refresh-detail" data-order-id="${this.escapeForAttr(orderId)}">
                                <i class="fas fa-rotate-right"></i> 重试加载
                            </button>
                        </div>
                    </div>
                    ${fallbackContent ? `
                        <div class="shop-order-detail-section">
                            <div class="shop-order-detail-section__header">
                                <div class="shop-order-detail-section__title"><i class="fas fa-box-open"></i> 当前缓存的订单内容</div>
                            </div>
                            <div class="shop-order-content-box">${fallbackContent}</div>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    },

    renderOrderDetailBody: function (payload = {}, fallbackItems = []) {
        const order = payload?.order || {};
        const payment = payload?.payment || {};
        const fulfillment = payload?.fulfillment || {};
        const tickets = payload?.tickets || {};
        const risk = payload?.risk || {};
        const user = order?.profiles || {};
        const orderId = String(order?.id || '').trim();
        const deliveryTask = fulfillment?.task || null;
        const orderItems = Array.isArray(order?.resolved_items) && order.resolved_items.length
            ? order.resolved_items
            : (Array.isArray(fallbackItems) ? fallbackItems : []);
        const linkedInventoryItems = Array.isArray(order?.linked_inventory_items) ? order.linked_inventory_items : [];
        const deliveryAttempts = Array.isArray(fulfillment?.attempts) ? fulfillment.attempts : [];
        const ticketRecords = Array.isArray(tickets?.records) ? tickets.records : [];
        const riskRecords = Array.isArray(risk?.records) ? risk.records : [];
        const avatarSeed = encodeURIComponent(String(user?.username || user?.email || order?.user_id || 'U'));
        const avatar = user?.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${avatarSeed}&backgroundColor=6b9ece`;
        const joinedContent = orderItems.map((item) => String(item?.content || '').trim()).filter(Boolean).join('\n');
        const safeOrderId = this.escapeHtml(orderId);
        const safeProductName = this.escapeHtml(order?.snapshot_product_name || orderItems[0]?.product_name || '未知商品');
        const siteLabel = String(payment?.site || order?.site || 'cn').trim().toLowerCase() === 'intl' ? 'INTL' : 'CN';
        const refundBadge = this.getOrderRefundStatusBadge(order);
        const deliveryBadge = this.getOrderDeliveryStatusBadge(order);
        const canRefund = !['refunded', 'full_refund'].includes(String(order?.refund_status || '').trim().toLowerCase());
        const taskForActions = deliveryTask
            ? {
                ...deliveryTask,
                attempts: deliveryAttempts,
                lock_state: this.getOrderDetailTaskLockState(deliveryTask)
            }
            : null;
        const heroPills = [
            this.renderDeliveryMetaBadge(`站点 ${siteLabel}`, 'neutral'),
            this.renderDeliveryMetaBadge(`数量 ${Math.max(1, Number(payment?.item_count || order?.item_count || orderItems.length || 1) || 1)}`, 'muted'),
            payment?.discount_code ? this.renderDeliveryMetaBadge(`优惠码 ${this.escapeHtml(String(payment.discount_code).toUpperCase())}`, 'processing') : '',
            order?.linkage_source ? this.renderDeliveryMetaBadge(`关联 ${this.escapeHtml(String(order.linkage_source).replace(/_/g, ' '))}`, 'muted') : ''
        ].filter(Boolean).join('');

        const inventoryMarkup = linkedInventoryItems.length
            ? linkedInventoryItems.map((item) => `
                <div class="shop-order-detail-list-row">
                    <div class="shop-order-detail-list-row__main">
                        <div class="shop-order-detail-list-row__title">${this.escapeHtml(item.product_name || '商品')}</div>
                        <div class="shop-order-detail-list-row__meta">
                            <span>ID ${this.escapeHtml(this.shortenDeliveryToken(item.id || '', 8, 4) || '—')}</span>
                            <span>状态 ${this.escapeHtml(item.status || '—')}</span>
                            <span>售出 ${this.escapeHtml(this.formatOrderDetailTime(item.sold_at))}</span>
                        </div>
                        <div class="shop-order-detail-list-row__content">${this.escapeHtml(this.truncateText(item.content || '无内容', 120))}</div>
                    </div>
                    ${item.id ? `
                        <button type="button" class="shop-order-detail-inline-btn" data-shop-action="inventory-show-detail" data-inventory-id="${this.escapeForAttr(item.id)}">
                            <i class="fas fa-info-circle"></i> 库存详情
                        </button>
                    ` : ''}
                </div>
            `).join('')
            : '<div class="shop-order-detail-empty-inline">当前订单没有精确命中的库存记录。</div>';

        const itemsMarkup = orderItems.length
            ? orderItems.map((item) => `
                <div class="shop-order-content-item">
                    <div class="shop-order-content-item-title">${this.escapeHtml(item.product_name || '商品')}</div>
                    <div class="shop-order-content-item-value">${this.escapeHtml(item.content || '无内容')}</div>
                </div>
            `).join('')
            : '<div class="shop-order-detail-empty-inline">暂无订单内容。</div>';

        const ticketMarkup = ticketRecords.length
            ? ticketRecords.map((ticket) => `
                <div class="shop-order-detail-list-row">
                    <div class="shop-order-detail-list-row__main">
                        <div class="shop-order-detail-list-row__title">${this.escapeHtml(this.getOrderTicketIssueLabel(ticket.issue_type))}</div>
                        <div class="shop-order-detail-list-row__meta">
                            <span>${this.escapeHtml(this.formatOrderDetailTime(ticket.created_at))}</span>
                            <span>${this.escapeHtml(ticket.id || '')}</span>
                        </div>
                        <div class="shop-order-detail-list-row__content">${this.escapeHtml(this.truncateText(ticket.description || '无描述', 96))}</div>
                    </div>
                    <div class="shop-order-detail-list-row__badge">${this.getOrderTicketStatusBadge(ticket.status)}</div>
                </div>
            `).join('')
            : '<div class="shop-order-detail-empty-inline">当前订单暂无工单。</div>';

        const riskMarkup = riskRecords.length
            ? riskRecords.map((record) => `
                <div class="shop-order-detail-list-row">
                    <div class="shop-order-detail-list-row__main">
                        <div class="shop-order-detail-list-row__title">${this.escapeHtml(record.alert_type || record.target_id || '风控信号')}</div>
                        <div class="shop-order-detail-list-row__meta">
                            <span>${this.escapeHtml(record.target_id || '—')}</span>
                            <span>${this.escapeHtml(this.formatOrderDetailTime(record.updated_at))}</span>
                        </div>
                        <div class="shop-order-detail-list-row__content">${this.escapeHtml(this.truncateText(record.note || record.resolution || '暂无补充说明', 96))}</div>
                    </div>
                    <div class="shop-order-detail-list-row__badge">${this.getOrderCaseStatusBadge(record.status)}</div>
                </div>
            `).join('')
            : `<div class="shop-order-detail-empty-inline">${risk?.candidate_targets?.length ? '当前订单未命中已落库的风控 case。' : '当前订单暂无风控 case。'}</div>`;

        const fulfillmentPills = [
            deliveryBadge,
            refundBadge,
            deliveryTask?.id ? this.renderDeliveryMetaBadge(`任务 ${this.shortenDeliveryToken(deliveryTask.id, 8, 4)}`, 'neutral') : '',
            taskForActions ? this.getDeliveryLockBadge(taskForActions) : '',
            fulfillment?.case ? this.getOrderCaseStatusBadge(fulfillment.case.status) : ''
        ].filter(Boolean).join('');

        return `
            <div class="shop-order-content-modal shop-order-detail-modal custom-scrollbar">
                <div class="shop-order-content-header shop-order-detail-header">
                    <div>
                        <div class="shop-order-detail-eyebrow">Order Detail</div>
                        <h3 class="shop-order-content-title">${safeProductName}</h3>
                    </div>
                    <div class="shop-order-detail-inline-actions">
                        <button type="button" class="shop-order-detail-inline-btn" data-shop-action="order-refresh-detail" data-order-id="${this.escapeForAttr(orderId)}">
                            <i class="fas fa-rotate-right"></i> 刷新
                        </button>
                        <button type="button" class="shop-order-content-close" data-shop-action="order-close-content" data-modal-id="orderContentModal" aria-label="关闭">&times;</button>
                    </div>
                </div>
                <div class="shop-order-content-body shop-order-detail-body">
                    <div class="shop-order-detail-hero">
                        <div class="shop-order-detail-user">
                            <img src="${this.escapeHtml(avatar)}" class="shop-order-detail-user__avatar" alt="avatar">
                            <div class="shop-order-detail-user__copy">
                                <div class="shop-order-detail-user__name">${this.escapeHtml(user?.username || 'Unknown')}</div>
                                <div class="shop-order-detail-user__email">${this.escapeHtml(user?.email || order?.user_id || '—')}</div>
                                <div class="shop-order-detail-user__id">用户 ID：<code>${this.escapeHtml(order?.user_id || '—')}</code></div>
                            </div>
                        </div>
                        <div class="shop-order-detail-hero__meta">
                            <div class="shop-order-content-meta">订单号：<code class="shop-order-content-order-id">${safeOrderId}</code></div>
                            <div class="shop-order-detail-hero__pills">${heroPills}</div>
                            <div class="shop-order-detail-hero__stats">
                                <div class="shop-order-detail-stat"><span>下单时间</span><strong>${this.escapeHtml(this.formatOrderDetailTime(order?.created_at))}</strong></div>
                                <div class="shop-order-detail-stat"><span>支付积分</span><strong>${this.escapeHtml(String(payment?.total_price || order?.total_price || order?.price_paid || 0))}</strong></div>
                                <div class="shop-order-detail-stat"><span>退款状态</span><strong>${refundBadge}</strong></div>
                                <div class="shop-order-detail-stat"><span>履约状态</span><strong>${deliveryBadge}</strong></div>
                            </div>
                        </div>
                    </div>

                    <div class="shop-order-detail-grid">
                        <div class="shop-order-detail-section">
                            <div class="shop-order-detail-section__header">
                                <div class="shop-order-detail-section__title"><i class="fas fa-boxes-stacked"></i> 库存与内容</div>
                                <div class="shop-order-detail-inline-actions">
                                    ${joinedContent ? `
                                        <button type="button" class="shop-order-detail-inline-btn" data-shop-action="order-copy-all-content" data-content="${this.escapeForAttr(joinedContent)}">
                                            <i class="fas fa-copy"></i> 复制全部内容
                                        </button>
                                    ` : ''}
                                </div>
                            </div>
                            <div class="shop-order-detail-list">${inventoryMarkup}</div>
                            <div class="shop-order-content-box">${itemsMarkup}</div>
                        </div>

                        <div class="shop-order-detail-section">
                            <div class="shop-order-detail-section__header">
                                <div class="shop-order-detail-section__title"><i class="fas fa-truck-fast"></i> 履约与动作</div>
                            </div>
                            <div class="shop-order-detail-hero__pills">${fulfillmentPills || '<span class="shop-order-detail-empty-inline">暂无履约上下文</span>'}</div>
                            <div class="shop-order-detail-kv">
                                <div><span>最近错误</span><strong>${this.escapeHtml(fulfillment?.delivery_last_error || deliveryTask?.last_error || '—')}</strong></div>
                                <div><span>最近更新</span><strong>${this.escapeHtml(this.formatOrderDetailTime(fulfillment?.delivery_updated_at || deliveryTask?.updated_at))}</strong></div>
                                <div><span>完成时间</span><strong>${this.escapeHtml(this.formatOrderDetailTime(fulfillment?.delivery_completed_at || deliveryTask?.delivered_at))}</strong></div>
                                <div><span>冲突次数</span><strong>${this.escapeHtml(String(deliveryTask?.conflict_count || 0))}</strong></div>
                            </div>
                            <div class="shop-order-detail-attempts">${deliveryTask ? this.renderDeliveryAttemptLines({ attempts: deliveryAttempts }) : '<div class="shop-order-detail-empty-inline">当前订单还没有履约任务。</div>'}</div>
                            <div class="shop-order-detail-inline-actions">
                                ${taskForActions ? this.renderDeliveryActionButtons(taskForActions) : ''}
                                ${canRefund ? `
                                    <button type="button" class="shop-order-detail-inline-btn shop-order-detail-inline-btn--danger" data-shop-action="order-refund" data-order-id="${this.escapeForAttr(orderId)}">
                                        <i class="fas fa-undo"></i> 订单退款
                                    </button>
                                ` : ''}
                            </div>
                        </div>
                    </div>

                    <div class="shop-order-detail-grid shop-order-detail-grid--secondary">
                        <div class="shop-order-detail-section">
                            <div class="shop-order-detail-section__header">
                                <div class="shop-order-detail-section__title"><i class="fas fa-life-ring"></i> 工单摘要</div>
                                <div class="shop-order-detail-hero__pills">
                                    ${this.renderDeliveryMetaBadge(`总数 ${Number(tickets?.total || 0)}`, Number(tickets?.total || 0) ? 'processing' : 'muted')}
                                    ${this.renderDeliveryMetaBadge(`待处理 ${Number(tickets?.pending || 0)}`, Number(tickets?.pending || 0) ? 'warn' : 'muted')}
                                </div>
                            </div>
                            <div class="shop-order-detail-list">${ticketMarkup}</div>
                        </div>

                        <div class="shop-order-detail-section">
                            <div class="shop-order-detail-section__header">
                                <div class="shop-order-detail-section__title"><i class="fas fa-shield-halved"></i> 风控摘要</div>
                                <div class="shop-order-detail-hero__pills">
                                    ${this.renderDeliveryMetaBadge(`Case ${Number(risk?.total || 0)}`, Number(risk?.total || 0) ? 'danger' : 'muted')}
                                    ${this.renderDeliveryMetaBadge(`未收口 ${Number(risk?.open || 0)}`, Number(risk?.open || 0) ? 'warn' : 'muted')}
                                </div>
                            </div>
                            <div class="shop-order-detail-list">${riskMarkup}</div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    // Show order detail in a modal
    showOrderContent: async function (orderId, itemsData) {
        const normalizedOrderId = String(orderId || '').trim();
        if (!normalizedOrderId) return;

        const fallbackItems = this.parseOrderItemsData(itemsData);
        const requestToken = (this.orderDetailRequestToken || 0) + 1;
        this.orderDetailRequestToken = requestToken;
        this.currentOrderDetailId = normalizedOrderId;
        this.closeDynamicModal?.('orderContentModal');

        const overlay = document.createElement('div');
        overlay.id = 'orderContentModal';
        overlay.dataset.shopOverlayClose = 'dynamic-modal';
        overlay.dataset.modalId = 'orderContentModal';
        overlay.className = 'shop-order-content-overlay';
        overlay.innerHTML = `<div id="orderContentShell">${this.buildOrderDetailLoadingMarkup(normalizedOrderId)}</div>`;

        this.bindOverlayDismiss(overlay, () => {
            this.currentOrderDetailId = '';
            this.closeDynamicModal('orderContentModal');
        });
        document.body.appendChild(overlay);
        requestAnimationFrame(() => {
            overlay.classList.add('is-visible');
        });

        try {
            const payload = await this.loadOrderDetailViaAdminApi(normalizedOrderId);
            if (requestToken !== this.orderDetailRequestToken) return;
            const shell = overlay.querySelector('#orderContentShell');
            if (shell) {
                shell.innerHTML = this.renderOrderDetailBody(payload, fallbackItems);
            }
        } catch (error) {
            console.error('[ShopAdmin] Failed to load order detail:', error);
            if (requestToken !== this.orderDetailRequestToken) return;
            const shell = overlay.querySelector('#orderContentShell');
            if (shell) {
                shell.innerHTML = this.buildOrderDetailErrorMarkup(error?.message || '订单详情加载失败', normalizedOrderId, fallbackItems);
            }
        }
    },

    // Open Enhanced Refund Modal
    openRefundModal: function (orderId) {
        const modalHtml = `
            <div id="refundModal" data-shop-overlay-close="dynamic-modal" data-modal-id="refundModal"
                class="shop-refund-modal-overlay">
                <div class="shop-refund-modal">
                    <h3 class="shop-refund-modal-title">
                        <span class="shop-refund-modal-title-icon">
                             <i class="fas fa-undo"></i>
                        </span>
                        订单退款处理
                    </h3>
                    
                    <div class="shop-refund-modal-section">
                        <label class="shop-refund-modal-label">选择退款后的库存状态</label>
                        <div class="shop-refund-status-grid">
                            <label class="shop-refund-status-option shop-refund-status-option--frozen">
                                <input type="radio" name="refundTargetStatus" value="frozen" checked>
                                <span class="shop-refund-status-option-label"><i class="fas fa-ban"></i> 冻结问题</span>
                            </label>
                            <label class="shop-refund-status-option shop-refund-status-option--available">
                                <input type="radio" name="refundTargetStatus" value="available">
                                <span class="shop-refund-status-option-label"><i class="fas fa-check-circle"></i> 重新上架</span>
                            </label>
                            <label class="shop-refund-status-option shop-refund-status-option--fault">
                                <input type="radio" name="refundTargetStatus" value="fault">
                                <span class="shop-refund-status-option-label"><i class="fas fa-exclamation-triangle"></i> 故障维修</span>
                            </label>
                            <label class="shop-refund-status-option shop-refund-status-option--reserve">
                                <input type="radio" name="refundTargetStatus" value="reserve">
                                <span class="shop-refund-status-option-label"><i class="fas fa-box"></i> 保留库存</span>
                            </label>
                        </div>
                    </div>

                    <div class="shop-refund-modal-section shop-refund-modal-section--remark">
                        <label class="shop-refund-modal-label">备注说明</label>
                        <textarea id="refundRemarkInput" class="shop-refund-modal-textarea refund-modal-input" placeholder="请填写退款的具体原因..."></textarea>
                    </div>
                    
                    <div class="shop-refund-modal-actions">
                        <button type="button" data-shop-action="refund-close-modal" data-modal-id="refundModal" class="refund-btn-cancel">取消</button>
                        <button type="button" data-shop-action="refund-submit" data-order-id="${this.escapeForAttr(orderId)}" class="refund-btn-confirm">确认退款</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        this.bindOverlayDismiss('refundModal', () => {
            this.closeDynamicModal('refundModal');
        });
        requestAnimationFrame(() => {
            document.getElementById('refundModal')?.classList.add('is-visible');
        });
    },

    submitRefund: async function (orderId, submitButton = null) {
        if (!this.requireWritableSite({ label: '执行订单退款' })) {
            return;
        }

        const writableSite = window.AdminSiteFilter?.getWritableSite?.() || null;
        const targetStatus = document.querySelector('input[name="refundTargetStatus"]:checked').value;
        const remark = document.getElementById('refundRemarkInput').value.trim();

        // Disable button to prevent double submit
        const btn = submitButton || document.querySelector('#refundModal [data-shop-action="refund-submit"]');
        const originalText = btn?.textContent || '确认退款';
        if (btn) {
            btn.disabled = true;
            btn.textContent = '处理中...';
        }

        try {
            const headers = await this.getAdminAuthHeaders();
            const response = await fetch(this.buildAdminRouteUrl('payments/shop-refund'), {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    orderId,
                    targetStatus,
                    remark: remark || null,
                    site: writableSite || window.AdminSiteFilter?.getSiteFilter?.() || 'all'
                })
            });
            const result = await response.json().catch(() => ({}));

            if (!response.ok || !result.success) {
                throw new Error(result.message || '退款失败');
            }

            alert(result.message || '退款成功');
            this.recordOrderResolutionFeedback(orderId, { targetStatus });
            this.invalidateShopTabCache();
            this.closeDynamicModal('refundModal');
            await this.searchOrders(); // Refresh Order List
            if (this.currentOrderDetailId && String(this.currentOrderDetailId) === String(orderId)) {
                await this.showOrderContent(orderId);
            }
            // Also try refresh inventory list if possible, or user will switch tab
            if (this.currentTab === 'inventory') this.loadInventoryList();
        } catch (err) {
            console.error(err);
            alert('Error: ' + err.message);
            if (btn) {
                btn.disabled = false;
                btn.textContent = originalText;
            }
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
                batchMenu.classList.remove('is-open');
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
        const inventoryView = document.getElementById('shop-view-inventory');
        const batchMenu = document.getElementById('batchActionMenu');
        const checkboxCells = document.querySelectorAll('#shop-view-inventory .shop-inventory-checkbox-col');

        if (this.isSelectionMode) {
            btn.classList.add('active');
            inventoryView?.classList.add('shop-inventory-selection-mode');
            if (batchBtn) batchBtn.classList.remove('admin-studio-inline-style-attr-3');
        } else {
            btn.classList.remove('active');
            inventoryView?.classList.remove('shop-inventory-selection-mode');
            if (batchBtn) batchBtn.classList.add('admin-studio-inline-style-attr-3');
            batchMenu?.classList.remove('is-open');
        }

        checkboxCells.forEach((cell) => {
            cell.classList.toggle('shop-inventory-checkbox-col--hidden', !this.isSelectionMode);
        });
    },

    toggleBatchMenu: function () {
        const menu = document.getElementById('batchActionMenu');
        if (menu) {
            menu.classList.toggle('is-open');
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
        if (menu) menu.classList.add('is-open');
    },

    batchDelete: async function () {
        if (!this.requireWritableSite({ label: '批量删除库存' })) {
            return;
        }

        const selectedIds = Array.from(document.querySelectorAll('.inv-checkbox:checked')).map(cb => cb.dataset.id);
        if (selectedIds.length === 0) {
            alert('请先选择要删除的库存项');
            return;
        }
        if (!confirm(`确定删除这 ${selectedIds.length} 项库存吗？`)) return;

        try {
            await this.callAdminMutation('inventory_batch_delete', {
                inventoryIds: selectedIds
            });

            // Refresh
            this.loadInventoryList(this.inventoryPage);
            document.getElementById('selectAllInv').checked = false;
            this.updateSelectionCount();

            // Close menu
            document.getElementById('batchActionMenu').classList.remove('is-open');

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

        document.querySelectorAll('.inventory-subtab-content').forEach(el => el.classList.add('admin-studio-inline-style-attr-3'));
        document.getElementById(`inventory-subtab-${tab}`).classList.remove('admin-studio-inline-style-attr-3');

        if (tab === 'browser') {
            this.initInventoryBrowser();
        } else if (tab === 'import') {
            this.loadInventoryProductList();
        }
    },

    initInventoryBrowser: async function () {
        const tbody = document.getElementById('inventoryTableBody');
        if (tbody) {
            tbody.innerHTML = this.buildInventoryTableLoadingSkeleton(5);
        }

        const inventoryLoadPromise = this.loadInventoryList();

        // Load products for custom dropdown
        const menu = document.getElementById('productDropdownMenu');
        if (menu && menu.children.length <= 1) {
            try {
                const payload = await this.loadShopProductsViaAdminApi({
                    status: 'all',
                    fields: 'names',
                    order: 'name_asc'
                });
                const data = Array.isArray(payload?.rows) ? payload.rows : [];
                if (data) {
                    data.forEach(p => {
                        const item = document.createElement('div');
                        item.className = 'custom-dropdown-item';
                        item.dataset.value = p.id;
                        item.textContent = p.name;
                        menu.appendChild(item);
                    });
                }
            } catch (err) {
                console.error('[ShopAdmin] Load inventory product filter options error:', err);
            }
        }

        // Initialize Flatpickr for date inputs if not already initialized
        this.initInventoryDatePickers();

        await inventoryLoadPromise;
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

        const loadGeneration = Number(this.shopTabLoadGeneration.inventory || 0);
        this.shopTabLoadState.inventory = 'loading';
        tbody.innerHTML = this.buildInventoryTableLoadingSkeleton(5);

        try {
            const result = await this.loadInventoryViaAdminApi(
                this.getInventoryQueryFilters({ page, pageSize: this.pageSize, includeSearch: true })
            );

            this.inventoryData = Array.isArray(result.items) ? result.items : [];

            // Update stats
            const stats = result.stats || {};
            document.getElementById('statReserve').textContent = stats.reserve || 0;
            document.getElementById('statAvailable').textContent = stats.available || 0;
            document.getElementById('statSold').textContent = stats.sold || 0;
            document.getElementById('statFrozen').textContent = stats.frozen || 0;
            if (stats.fault !== undefined) document.getElementById('statFault').textContent = stats.fault; // Update fault stats
            document.getElementById('statFault').textContent = stats.fault || 0; // Fault stat

            // Render table
            if (this.inventoryData.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" class="shop-inventory-empty-cell">暂无数据</td></tr>';
                if (Number(this.shopTabLoadGeneration.inventory || 0) === loadGeneration) {
                    this.shopTabLoadState.inventory = 'loaded';
                }
                return;
            }

            tbody.innerHTML = this.inventoryData.map(item => {
                const statusBadge = this.getStatusBadge(item.status);
                const createdAt = new Date(item.created_at).toLocaleString('zh-CN');
                const safeCreatedAt = this.escapeHtml(createdAt);
                const safeProductName = this.escapeHtml(item.product_name || '-');
                const safeItemId = this.escapeForAttr(String(item.id || ''));
                const safeFullContent = this.escapeForAttr(item.content || '');
                const safeBuyerEmail = this.escapeHtml(item.buyer_email || '-');
                const safeBuyerOrderId = this.escapeHtml(item.order_id?.slice(0, 8) || '');
                const buyerInfo = item.status === 'sold'
                    ? `<div class="shop-inventory-buyer-email">${safeBuyerEmail}</div><div class="shop-inventory-buyer-order">${safeBuyerOrderId}</div>`
                    : '<span class="shop-inventory-empty-action">-</span>';
                const checkboxCellClass = this.isSelectionMode
                    ? 'inv-checkbox-col shop-inventory-checkbox-col'
                    : 'inv-checkbox-col shop-inventory-checkbox-col shop-inventory-checkbox-col--hidden';

                // Extract email only (assuming format: email----password----recovery)
                const emailOnly = this.escapeHtml(item.content.split('----')[0] || item.content);
                return `
                    <tr>
                        <td class="${checkboxCellClass}">
                            <input type="checkbox" class="inv-checkbox" data-id="${safeItemId}" data-shop-change="inventory-selection-count">
                        </td>
                        <td>${safeProductName}</td>
                        <td class="shop-inventory-selection-toggle-cell" data-shop-action="inventory-toggle-selection-cell">
                            <div class="content-cell shop-inventory-content-chip" 
                                 data-content="${safeFullContent}" 
                                 data-shop-action="inventory-copy-content"
                                 title="点击复制全部内容&#10;───────────&#10;${this.escapeForAttr(item.content)}"
                                 >
                                ${emailOnly}
                            </div>
                        </td>
                        <td>${statusBadge}</td>
                        <td class="shop-inventory-created-at">${safeCreatedAt}</td>
                        <td>${buyerInfo}</td>
                        <td>
                            <div class="shop-inventory-actions">
                                <button data-shop-action="inventory-show-detail" data-inventory-id="${safeItemId}" class="btn-icon-sm shop-inventory-action-btn" title="详情"><i class="fas fa-info-circle"></i></button>
                                ${item.status === 'sold' ? `<button data-shop-action="inventory-open-fault-modal" data-inventory-id="${safeItemId}" class="btn-icon-sm shop-inventory-action-btn shop-inventory-action-btn--danger" title="标记故障"><i class="fas fa-exclamation-triangle"></i></button>` : ''}
                                ${item.status !== 'sold' ? `<button data-shop-action="inventory-delete-item" data-inventory-id="${safeItemId}" class="btn-icon-sm shop-inventory-action-btn" title="删除"><i class="fas fa-trash"></i></button>` : ''}
                                ${item.status === 'available' ? `<button data-shop-action="inventory-freeze-item" data-inventory-id="${safeItemId}" data-freeze="true" class="btn-icon-sm shop-inventory-action-btn" title="冻结"><i class="fas fa-ban"></i></button>` : ''}
                                ${item.status === 'frozen' ? `<button data-shop-action="inventory-freeze-item" data-inventory-id="${safeItemId}" data-freeze="false" class="btn-icon-sm shop-inventory-action-btn" title="解冻"><i class="fas fa-check"></i></button>` : ''}
                                ${item.status === 'reserve' ? `<button data-shop-action="inventory-release-item" data-inventory-id="${safeItemId}" class="btn-icon-sm shop-inventory-action-btn" title="上架"><i class="fas fa-rocket"></i></button>` : ''}
                                ${item.status === 'fault' ? `<button data-shop-action="inventory-release-item" data-inventory-id="${safeItemId}" class="btn-icon-sm shop-inventory-action-btn shop-inventory-action-btn--repair" title="修复/上架"><i class="fas fa-wrench"></i></button>` : ''}
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');

            // Calculate total for pagination
            const total = Number(result.total || 0);
            this.renderPagination('inventoryPagination', page, total, this.pageSize, 'loadInventoryList');

            // Enable horizontal scroll with mouse wheel for mobile
            const invTableContainer = document.querySelector('#shop-view-inventory .shop-table-container');
            if (invTableContainer && window.enableHorizontalScroll) {
                window.enableHorizontalScroll(invTableContainer);
            }

            if (Number(this.shopTabLoadGeneration.inventory || 0) === loadGeneration) {
                this.shopTabLoadState.inventory = 'loaded';
            }

        } catch (err) {
            console.error('[ShopAdmin] Load inventory error:', err);
            if (Number(this.shopTabLoadGeneration.inventory || 0) === loadGeneration) {
                this.shopTabLoadState.inventory = 'error';
            }
            tbody.innerHTML = `<tr><td colspan="7" class="shop-inventory-empty-cell shop-inventory-empty-cell--error">加载失败: ${this.escapeHtml(err.message || '未知错误')}</td></tr>`;
        }
    },

    getInventoryStatusMeta: function (status) {
        const badges = {
            reserve: { label: '储备', icon: 'fa-archive', modifier: 'reserve' },
            available: { label: '在售', icon: 'fa-check-circle', modifier: 'available' },
            sold: { label: '已售', icon: 'fa-shopping-cart', modifier: 'sold' },
            frozen: { label: '冻结', icon: 'fa-ban', modifier: 'frozen' },
            fault: { label: '故障', icon: 'fa-exclamation-triangle', modifier: 'fault' }
        };

        return badges[status] || {
            label: status || '未知',
            icon: 'fa-circle',
            modifier: 'unknown'
        };
    },

    getStatusBadge: function (status) {
        const meta = this.getInventoryStatusMeta(status);
        return `<span class="shop-inventory-status-badge shop-inventory-status-badge--${meta.modifier}"><i class="fas ${meta.icon}"></i> ${this.escapeHtml(meta.label)}</span>`;
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
        if (!this.requireWritableSite({ label: '删除库存项' })) {
            return;
        }

        if (!confirm('确定删除此库存项？')) return;
        try {
            await this.callAdminMutation('inventory_delete', { inventoryId: id });
            this.loadInventoryList(this.inventoryPage);
        } catch (err) {
            alert('删除失败: ' + err.message);
        }
    },

    freezeInventoryItem: async function (id, freeze) {
        if (!this.requireWritableSite({ label: freeze ? '冻结库存项' : '解冻库存项' })) {
            return;
        }

        try {
            await this.callAdminMutation('inventory_update_status', {
                inventoryId: id,
                status: freeze ? 'frozen' : 'available',
                remark: freeze ? undefined : ''
            });
            this.loadInventoryList(this.inventoryPage);
        } catch (err) {
            alert('操作失败: ' + err.message);
        }
    },

    releaseOne: async function (id) {
        if (!this.requireWritableSite({ label: '重新上架库存项' })) {
            return;
        }

        try {
            await this.callAdminMutation('inventory_update_status', {
                inventoryId: id,
                status: 'available',
                remark: ''
            });
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
            const originalText = element.textContent;
            element.classList.add('shop-inventory-content-chip--copied');
            element.innerHTML = '<span class="shop-inventory-copy-feedback"><i class="fas fa-check shop-inventory-copy-feedback-icon"></i> 已复制</span>';
            setTimeout(() => {
                element.classList.remove('shop-inventory-content-chip--copied');
                element.textContent = originalText;
            }, 1000);
        }).catch(err => {
            console.error('Copy failed:', err);
            alert('复制失败');
        });
    },

    // Copy list content
    copyListContent: function (btn) {
        const content = btn.dataset.content;
        navigator.clipboard.writeText(content).then(() => {
            const originalHtml = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-check"></i>';
            setTimeout(() => btn.innerHTML = originalHtml, 1500);
        });
    },

    // Export list content
    exportListContent: function (btn, filename) {
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
            <div id="markFaultModal" data-shop-overlay-close="dynamic-modal" data-modal-id="markFaultModal" class="shop-inventory-fault-overlay">
                <div class="shop-inventory-fault-modal">
                    <h3 class="shop-inventory-fault-title"><i class="fas fa-exclamation-triangle"></i> 标记故障</h3>
                    
                    <div class="shop-inventory-fault-field">
                        <label class="shop-inventory-fault-label">故障说明 / 备注</label>
                        <textarea id="faultRemarkInput" class="shop-inventory-fault-textarea" placeholder="请输入故障原因..."></textarea>
                    </div>
                    
                    <div class="shop-inventory-fault-actions">
                        <button type="button" data-shop-action="fault-modal-close" data-modal-id="markFaultModal" class="shop-inventory-fault-btn shop-inventory-fault-btn--cancel">取消</button>
                        <button type="button" data-shop-action="fault-modal-submit" data-inventory-id="${this.escapeForAttr(String(itemId || ''))}" class="shop-inventory-fault-btn shop-inventory-fault-btn--confirm">确认标记</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        this.bindOverlayDismiss('markFaultModal', () => {
            this.closeDynamicModal('markFaultModal');
        });
        requestAnimationFrame(() => {
            document.getElementById('markFaultModal')?.classList.add('is-visible');
        });
        setTimeout(() => document.getElementById('faultRemarkInput').focus(), 100);
    },

    submitFault: async function (itemId) {
        if (!this.requireWritableSite({ label: '标记库存故障' })) {
            return;
        }

        const remark = document.getElementById('faultRemarkInput').value.trim();
        // Allow empty remark if just marking as fault? Usually user wants to verify reason.
        if (!remark) {
            alert('请输入故障原因');
            return;
        }

        try {
            await this.callAdminMutation('inventory_update_status', {
                inventoryId: itemId,
                status: 'fault',
                remark
            });

            this.closeDynamicModal('markFaultModal');

            // Reload list
            this.loadInventoryList(this.inventoryPage);

        } catch (err) {
            console.error(err);
            alert('操作失败: ' + (err.message || '未知错误'));
        }
    },

    // Show inventory detail modal
    showInventoryDetail: async function (inventoryId) {
        // Build modal content
        let modalHtml = `
            <div id="inventoryDetailModal" data-shop-overlay-close="dynamic-modal" data-modal-id="inventoryDetailModal" class="shop-inventory-detail-overlay">
                <div class="shop-inventory-detail-modal custom-scrollbar">
                    <div class="shop-inventory-detail-header">
                        <h3 class="shop-inventory-detail-title"><i class="fas fa-info-circle"></i> 库存详情</h3>
                        <button type="button" data-shop-action="inventory-detail-close" data-modal-id="inventoryDetailModal" class="shop-inventory-detail-close" aria-label="关闭">&times;</button>
                    </div>
                    <div id="detailContent" class="shop-inventory-detail-content">
                        ${this.buildInventoryDetailLoadingSkeleton()}
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        this.bindOverlayDismiss('inventoryDetailModal', () => {
            this.closeDynamicModal('inventoryDetailModal');
        });
        requestAnimationFrame(() => {
            document.getElementById('inventoryDetailModal')?.classList.add('is-visible');
        });

        try {
            const detailPayload = await this.loadInventoryDetailViaAdminApi(inventoryId);
            const invData = detailPayload?.inventory || null;
            const orderData = detailPayload?.order || null;
            const historyItems = Array.isArray(detailPayload?.historyItems) ? detailPayload.historyItems : [];
            const sameOrderItems = Array.isArray(detailPayload?.sameOrderItems) ? detailPayload.sameOrderItems : [];

            if (!invData) {
                throw new Error('库存记录不存在');
            }

            // Build detail content
            const statusMeta = this.getInventoryStatusMeta(invData.status);
            const safeMainContent = this.escapeHtml(invData.content || '');
            const safeProductName = this.escapeHtml(invData.shop_products?.name || '-');
            const safeStatusLabel = this.escapeHtml(statusMeta.label);
            const safeCreatedAt = this.escapeHtml(new Date(invData.created_at).toLocaleString('zh-CN'));
            const safeBatchId = this.escapeHtml(invData.batch_id || '-');
            const safeRemark = this.escapeHtml(invData.remark || '');

            const renderInventoryDetailListActions = (items, toneClass, filename) => {
                const joined = items.map((entry) => entry.shop_inventory?.content || '').join('\n');
                return `
                    <div class="shop-inventory-detail-section-actions">
                        <button type="button" data-shop-action="inventory-detail-copy-list" data-content="${this.escapeForAttr(joined)}" class="shop-inventory-detail-inline-btn ${toneClass}">
                            <i class="fas fa-copy"></i> 复制
                        </button>
                        <button type="button" data-shop-action="inventory-detail-export-list" data-content="${this.escapeForAttr(joined)}" data-filename="${this.escapeForAttr(filename)}" class="shop-inventory-detail-inline-btn ${toneClass}">
                            <i class="fas fa-download"></i> 导出
                        </button>
                    </div>
                `;
            };

            const renderInventoryDetailEntries = (items, entryClass) => `
                <div class="shop-inventory-detail-entry-list custom-scrollbar">
                    ${items.map((entry) => {
                    const content = entry.shop_inventory?.content || '';
                    const display = this.escapeHtml(content.split('----')[0] || content);
                    return `
                            <div class="shop-inventory-detail-entry ${entryClass}"
                                 data-shop-action="inventory-detail-copy-entry" data-content="${this.escapeForAttr(content)}"
                                 title="点击复制">
                                ${display}
                            </div>
                        `;
                }).join('')}
                </div>
            `;

            let detailHtml = `
                <div class="shop-inventory-detail-section shop-inventory-detail-section--primary">
                    <div class="shop-inventory-detail-section-label">账号内容</div>
                    <div class="shop-inventory-detail-code">${safeMainContent}</div>
                    <button type="button" data-shop-action="inventory-detail-copy-main" data-content="${this.escapeForAttr(invData.content)}"
                        class="shop-inventory-detail-inline-btn shop-inventory-detail-inline-btn--primary">
                        <i class="fas fa-copy"></i> 复制
                    </button>
                </div>

                <div class="shop-inventory-detail-grid">
                    <div class="shop-inventory-detail-card">
                        <div class="shop-inventory-detail-card-label">商品</div>
                        <div class="shop-inventory-detail-card-value">${safeProductName}</div>
                    </div>
                    <div class="shop-inventory-detail-card">
                        <div class="shop-inventory-detail-card-label">状态</div>
                        <div class="shop-inventory-detail-card-value shop-inventory-detail-card-value--status shop-inventory-detail-card-value--${statusMeta.modifier}">${safeStatusLabel}</div>
                    </div>
                    <div class="shop-inventory-detail-card">
                        <div class="shop-inventory-detail-card-label">导入时间</div>
                        <div class="shop-inventory-detail-card-value shop-inventory-detail-card-value--small">${safeCreatedAt}</div>
                    </div>
                    <div class="shop-inventory-detail-card">
                        <div class="shop-inventory-detail-card-label">批次</div>
                        <div class="shop-inventory-detail-card-value shop-inventory-detail-card-value--small">${safeBatchId}</div>
                    </div>
                </div>
            `;

            if (invData.remark) {
                detailHtml += `
                    <div class="shop-inventory-detail-alert">
                        <div class="shop-inventory-detail-alert-title"><i class="fas fa-exclamation-triangle"></i> 故障/备注</div>
                        <div class="shop-inventory-detail-alert-body">${safeRemark}</div>
                    </div>
                `;
            }

            if (invData.buyer_id || invData.status === 'sold') {
                const buyerEmail = orderData?.profiles?.email || invData.buyer_email || invData.profiles?.email || '-';
                const orderId = orderData?.id || invData.order_id || null;
                const payTime = orderData?.created_at || invData.sold_at;
                const price = orderData?.price_paid !== undefined ? orderData.price_paid : '-';
                const safeBuyerEmail = this.escapeHtml(buyerEmail);
                const safeOrderId = this.escapeHtml(orderId || '');
                const safePayTime = this.escapeHtml(payTime ? new Date(payTime).toLocaleString('zh-CN') : '-');
                const safePrice = this.escapeHtml(String(price));

                detailHtml += `
                    <div class="shop-inventory-detail-sold-section">
                        <div class="shop-inventory-detail-section-heading"><i class="fas fa-shopping-cart"></i> 售出信息</div>
                        <div class="shop-inventory-detail-grid shop-inventory-detail-grid--sold">
                            <div class="shop-inventory-detail-card shop-inventory-detail-card--sold">
                                <div class="shop-inventory-detail-card-label">购买者</div>
                                <div class="shop-inventory-detail-card-value shop-inventory-detail-card-value--small shop-inventory-detail-card-value--break">${safeBuyerEmail}</div>
                            </div>
                            <div class="shop-inventory-detail-card shop-inventory-detail-card--sold">
                                <div class="shop-inventory-detail-card-label">订单号</div>
                                <div class="shop-inventory-detail-card-value shop-inventory-detail-card-value--mono shop-inventory-detail-card-value--break" title="${safeOrderId}">
                                    ${orderId ? safeOrderId : '<span class="shop-inventory-detail-muted">未找到关联订单</span>'}
                                </div>
                            </div>
                            <div class="shop-inventory-detail-card shop-inventory-detail-card--sold">
                                <div class="shop-inventory-detail-card-label">下单时间</div>
                                <div class="shop-inventory-detail-card-value shop-inventory-detail-card-value--small">${safePayTime}</div>
                            </div>
                            <div class="shop-inventory-detail-card shop-inventory-detail-card--sold">
                                <div class="shop-inventory-detail-card-label">支付积分</div>
                                <div class="shop-inventory-detail-card-value shop-inventory-detail-card-value--small shop-inventory-detail-card-value--strong">${safePrice}</div>
                            </div>
                        </div>
                    </div>
                `;

                if (sameOrderItems.length > 0) {
                    detailHtml += `
                        <div class="shop-inventory-detail-related-section">
                            <div class="shop-inventory-detail-related-header">
                                <div class="shop-inventory-detail-related-title shop-inventory-detail-related-title--warning"><i class="fas fa-layer-group"></i> 本次交易关联商品 (${sameOrderItems.length})</div>
                                ${renderInventoryDetailListActions(sameOrderItems, 'shop-inventory-detail-inline-btn--warning', 'sameday_orders.txt')}
                            </div>
                            ${renderInventoryDetailEntries(sameOrderItems, 'shop-inventory-detail-entry--warning')}
                        </div>
                    `;
                }

                if (historyItems.length > 0) {
                    detailHtml += `
                        <div class="shop-inventory-detail-related-section">
                            <div class="shop-inventory-detail-related-header">
                                <div class="shop-inventory-detail-related-title shop-inventory-detail-related-title--info"><i class="fas fa-history"></i> 该买家购买历史 (${historyItems.length})</div>
                                ${renderInventoryDetailListActions(historyItems, 'shop-inventory-detail-inline-btn--info', 'order_history.txt')}
                            </div>
                            ${renderInventoryDetailEntries(historyItems, 'shop-inventory-detail-entry--info')}
                        </div>
                    `;
                }
            }

            document.getElementById('detailContent').innerHTML = detailHtml;

        } catch (err) {
            console.error('[ShopAdmin] Detail error:', err);
            document.getElementById('detailContent').innerHTML = `<div class="shop-inventory-detail-error">加载失败: ${this.escapeHtml(err.message || '未知错误')}</div>`;
        }
    },

    // Release Reserve Modal
    openReleaseModal: async function () {
        const modal = document.getElementById('releaseReserveModal');
        const select = document.getElementById('releaseProductSelect');

        // Load products
        select.innerHTML = '<option value="">请选择商品</option>';
        const payload = await this.loadShopProductsViaAdminApi({
            status: 'all',
            fields: 'names',
            order: 'name_asc'
        });
        const data = Array.isArray(payload?.rows) ? payload.rows : [];
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
        modal.classList.add('active');
    },

    closeReleaseModal: function () {
        document.getElementById('releaseReserveModal')?.classList.remove('active');
    },

    closeImportModal: function () {
        document.getElementById('importInventoryModal')?.classList.remove('active');
    },

    doImport: async function () {
        if (!this.requireWritableSite({ label: '导入库存（弹窗）' })) {
            return;
        }

        const productId = document.getElementById('importProductSelect')?.value || '';
        const contentInput = document.getElementById('importContentInput');
        const content = contentInput?.value || '';
        const status = document.querySelector('#importInventoryModal input[name="importStatus"]:checked')?.value || 'available';

        if (!productId) { alert('请选择商品'); return; }
        if (!content.trim()) { alert('请输入账号内容'); return; }

        const contentLines = content.split('\n').map((line) => line.trim()).filter(Boolean);
        if (contentLines.length === 0) { alert('请输入有效的账号内容'); return; }

        try {
            const { batchId, imported } = await this.performInventoryImport({
                productId,
                contentLines,
                status
            });
            alert(`成功导入 ${imported} 个账号\n批次号: ${batchId}`);
            contentInput.value = '';
            this.updateLegacyImportLineCount();
            this.closeImportModal();
            await this.loadInventoryList(this.inventoryPage);
            await this.loadProducts();
            await this.loadInventoryProductList();
        } catch (err) {
            alert('导入失败: ' + err.message);
        }
    },

    releaseReserve: async function () {
        if (!this.requireWritableSite({ label: '批量释放储备库存' })) {
            return;
        }

        const productId = document.getElementById('releaseProductSelect').value;
        const count = parseInt(document.getElementById('releaseCount').value) || null;
        const beforeDate = document.getElementById('releaseBeforeDate').value || null;

        if (!productId) { alert('请选择商品'); return; }
        if (!count && !beforeDate) { alert('请指定数量或日期'); return; }

        try {
            const result = await this.callAdminMutation('inventory_release_reserve', {
                productId,
                count,
                beforeDate: beforeDate ? new Date(beforeDate).toISOString() : null
            });
            alert(result.message || '释放完成');
            this.closeReleaseModal();
            await this.loadInventoryList(this.inventoryPage);
            await this.loadProducts();
            await this.loadInventoryProductList();
        } catch (err) {
            alert('释放失败: ' + err.message);
        }
    },

    // Import View Functions
    categoryData: [], // Dynamic category data from database
    contextMenuCategory: null, // Currently selected category for context menu

    // Load categories from database
    loadCategories: async function ({ force = false } = {}) {
        const fallbackCategories = [
            { id: 'account', name: 'account', color: '#6b9ece', sort_order: 0 },
            { id: 'gemini', name: 'Gemini', color: '#f4b400', sort_order: 1 },
            { id: 'other', name: 'other', color: '#9aa0a6', sort_order: 99 }
        ];

        if (!force && Array.isArray(this.categoryData) && this.categoryData.length > 0) {
            return this.categoryData;
        }

        if (!force && this.categoryFetchPromise) {
            await this.categoryFetchPromise;
            return this.categoryData;
        }

        this.categoryFetchPromise = (async () => {
            try {
                console.log('loadCategories: fetching from shop_categories...');
                const payload = await this.loadShopCategoriesViaAdminApi();
                const data = Array.isArray(payload?.rows) ? payload.rows : [];

                console.log('loadCategories result:', { data });

                if (!data || data.length === 0) {
                    console.warn('shop_categories table is empty, using defaults');
                    this.categoryData = fallbackCategories;
                    return this.categoryData;
                }

                this.categoryData = data;
                console.log('loadCategories: loaded', this.categoryData.length, 'categories');
                return this.categoryData;
            } catch (error) {
                console.error('Failed to load categories:', error);
                this.categoryData = fallbackCategories;
                return this.categoryData;
            }
        })();

        try {
            return await this.categoryFetchPromise;
        } finally {
            this.categoryFetchPromise = null;
        }
    },

    initImportView: async function () {
        // Target the tree container (new structure)
        const treeContainer = document.getElementById('importProductTree');
        // Clear and add loading state
        const loadGeneration = Number(this.shopTabLoadGeneration.import || 0);
        this.shopTabLoadState.import = 'loading';
        treeContainer.innerHTML = this.buildImportTreeLoadingSkeleton();

        // Reset selection
        document.getElementById('importViewProductId').value = '';
        document.getElementById('targetProductName').classList.remove('shop-import-target-product--visible');
        document.getElementById('targetProductName').textContent = '';

        try {
            // Load categories first
            await this.loadCategories();

            const payload = await this.loadShopProductsViaAdminApi({
                status: 'all',
                fields: 'import',
                order: 'sort_order_asc'
            });
            const allProducts = Array.isArray(payload?.rows) ? payload.rows : [];
            this.allProductsForImport = allProducts
                .filter((item) => item?.is_active !== false)
                .sort((a, b) => Number(a?.sort_order || 0) - Number(b?.sort_order || 0));
            this.deletedProductsForImport = allProducts
                .filter((item) => item?.is_active === false)
                .sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''), 'zh-CN'));
            this.renderImportList();
            if (Number(this.shopTabLoadGeneration.import || 0) === loadGeneration) {
                this.shopTabLoadState.import = 'loaded';
            }

        } catch (e) {
            console.error('Failed to load products for import view', e);
            if (Number(this.shopTabLoadGeneration.import || 0) === loadGeneration) {
                this.shopTabLoadState.import = 'error';
            }
            treeContainer.innerHTML = '<div class="shop-import-tree-state shop-import-tree-state--error">加载失败</div>';
        }
    },

    // Filter Import List
    filterImportList: function (categoryOrBtn, btnEl) {
        let category = categoryOrBtn;

        // Handle if called via button click (legacy/subtab)
        if (typeof categoryOrBtn !== 'string' && categoryOrBtn.tagName) {
            // Legacy callers could pass the clicked element as the first argument.
            // Value-only callers could pass only the selected category string.
        }

        // Correct logic:
        // By default, categoryOrBtn is the Category String.
        // btnEl is optional when the caller also passes the originating button.

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
            treeContainer.innerHTML = '<div class="shop-import-tree-state">暂无商品</div>';
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
                <i class="fas fa-folder tree-folder-icon ${this.buildCategoryColorClass(folderColor)}"></i>
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
                    setTimeout(() => item.classList.add('tree-product-item--drag-dim'), 0);
                };
                item.ondragend = () => {
                    item.classList.remove('dragging');
                    item.classList.remove('tree-product-item--drag-dim');
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
                <i class="fas fa-trash tree-folder-icon tree-folder-icon--recycle-bin"></i>
                <span class="tree-category-name tree-category-name--muted">回收站</span>
                <span class="tree-category-count tree-category-count--danger">${this.deletedProductsForImport.length}</span>
            `;
            recycleBinHeader.onclick = () => this.toggleTreeCategory(recycleBinDiv);

            const recycleBinChildren = document.createElement('div');
            recycleBinChildren.className = 'tree-children';
            recycleBinChildren.dataset.category = '__recycle_bin__';

            this.deletedProductsForImport.forEach(p => {
                const item = document.createElement('div');
                item.className = 'tree-product-item deleted-product tree-product-item--deleted';
                item.dataset.id = p.id;
                item.dataset.name = p.name;
                item.onclick = () => this.selectImportProduct(p.id, p.name);
                item.innerHTML = `
                    <i class="fas fa-file-alt tree-product-icon tree-product-icon--danger"></i>
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
    reorderProduct: async function (productId, targetCategory, beforeId, options = {}) {
        if (!productId) return;

        const product = this.allProductsForImport.find(p => p.id === productId);
        if (!product) return;

        const sourceCategory = product.category;
        const isMovingCategory = sourceCategory !== targetCategory;
        if (options.skipWritableSiteCheck !== true) {
            if (isMovingCategory) {
                if (!this.requireWritableSite({ label: '移动商品分类' })) {
                    return;
                }
            } else if (!this.requireWritableSite({ label: '调整商品排序' })) {
                return;
            }
        }

        const targetProducts = this.allProductsForImport
            .filter(p => p.category === targetCategory && p.id !== productId)
            .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

        let insertIndex = targetProducts.length;
        if (beforeId) {
            const beforeIndex = targetProducts.findIndex(p => p.id === beforeId);
            if (beforeIndex !== -1) insertIndex = beforeIndex;
        }

        const reorderedTargetProducts = [...targetProducts];
        reorderedTargetProducts.splice(insertIndex, 0, product);

        const sourceProducts = isMovingCategory
            ? this.allProductsForImport
                .filter((entry) => entry.category === sourceCategory && entry.id !== productId)
                .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
            : [];

        const assignments = [];
        const seenProductIds = new Set();

        reorderedTargetProducts.forEach((entry, idx) => {
            if (seenProductIds.has(entry.id)) return;
            assignments.push({
                id: entry.id,
                category: targetCategory,
                sortOrder: idx
            });
            seenProductIds.add(entry.id);
        });

        sourceProducts.forEach((entry, idx) => {
            if (seenProductIds.has(entry.id)) return;
            assignments.push({
                id: entry.id,
                category: sourceCategory,
                sortOrder: idx
            });
            seenProductIds.add(entry.id);
        });

        const changedAssignments = assignments.filter((entry) => {
            const currentProduct = this.allProductsForImport.find((candidate) => candidate.id === entry.id);
            if (!currentProduct) return false;
            return String(currentProduct.category || '') !== entry.category
                || Number(currentProduct.sort_order || 0) !== entry.sortOrder;
        });

        if (!changedAssignments.length) {
            return;
        }

        try {
            const result = await this.callAdminMutation('reorder_products', {
                assignments: changedAssignments
            });
            const updatedProducts = Array.isArray(result?.products) ? result.products : [];
            const updatedMap = new Map(updatedProducts.map((entry) => [String(entry.id), entry]));

            this.allProductsForImport.forEach((entry) => {
                const updatedEntry = updatedMap.get(String(entry.id));
                if (!updatedEntry) return;
                entry.category = updatedEntry.category;
                entry.sort_order = updatedEntry.sort_order;
            });

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

    getCategoryColorToken: function (color) {
        const normalized = String(color || '').trim().toLowerCase();
        const tokenMap = {
            '#6b9ece': 'blue',
            '#f4b400': 'yellow',
            '#0f9d58': 'green',
            '#4ade80': 'green-bright',
            '#e57373': 'red-soft',
            '#ea4335': 'red',
            '#9c27b0': 'purple',
            '#a78bfa': 'purple-soft',
            '#f472b6': 'pink',
            '#fb923c': 'orange',
            '#22d3d8': 'cyan',
            '#74aa9c': 'teal',
            '#9aa0a6': 'gray',
            '#ffffff': 'white',
            '#ffeb3b': 'lemon',
            '#ff9800': 'amber',
            '#4caf50': 'green-soft'
        };
        return tokenMap[normalized] || 'blue';
    },

    buildCategoryColorClass: function (color) {
        return `category-color--${this.getCategoryColorToken(color)}`;
    },

    setCategoryColorClasses: function (element, color) {
        if (!element) return;
        const colorClasses = Array.from(element.classList).filter((className) => className.startsWith('category-color--'));
        colorClasses.forEach((className) => element.classList.remove(className));
        element.classList.add(this.buildCategoryColorClass(color));
    },

    renderDeliveryTrendBarSvg: function (totalHeight, deadHeight = 0) {
        const safeTotalHeight = Math.max(0, Math.min(100, Number(totalHeight || 0)));
        const safeDeadHeight = Math.max(0, Math.min(100, Number(deadHeight || 0)));
        return `
            <svg class="shop-delivery-trend-bar-svg" viewBox="0 0 24 100" preserveAspectRatio="none" aria-hidden="true">
                <rect class="shop-delivery-trend-bar-svg-fill" x="0" y="${100 - safeTotalHeight}" width="24" height="${safeTotalHeight}" rx="7" ry="7"></rect>
                ${safeDeadHeight ? `<rect class="shop-delivery-trend-bar-svg-fill shop-delivery-trend-bar-svg-fill--dead" x="5" y="${100 - safeDeadHeight}" width="14" height="${safeDeadHeight}" rx="7" ry="7"></rect>` : ''}
            </svg>
        `;
    },

    closeCategoryContextMenu: function () {
        const menu = document.getElementById('categoryContextMenu');
        if (!menu) return;
        menu.classList.remove(
            'show',
            'tree-context-menu--anchor-left',
            'tree-context-menu--anchor-right',
            'tree-context-menu--anchor-up',
            'tree-context-menu--anchor-down'
        );
        if (menu.parentElement !== document.body) {
            document.body.appendChild(menu);
        }
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
        const anchor = e.currentTarget
            || Array.from(document.querySelectorAll('.tree-category-header')).find((element) => element.dataset.category === categoryKey)
            || null;
        if (!anchor) return;

        this.closeCategoryContextMenu();
        anchor.appendChild(menu);
        menu.classList.add('show');

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const menuRect = menu.getBoundingClientRect();
        const anchorRect = anchor.getBoundingClientRect();
        const alignRight = anchorRect.left + menuRect.width > viewportWidth - 10;
        const alignUp = anchorRect.bottom + menuRect.height > viewportHeight - 10 && anchorRect.top > menuRect.height + 10;
        menu.classList.toggle('tree-context-menu--anchor-left', !alignRight);
        menu.classList.toggle('tree-context-menu--anchor-right', alignRight);
        menu.classList.toggle('tree-context-menu--anchor-down', !alignUp);
        menu.classList.toggle('tree-context-menu--anchor-up', alignUp);

        // Highlight current color
        const currentColor = this.getCategoryColor(categoryKey);
        menu.querySelectorAll('.color-option').forEach(opt => {
            opt.classList.toggle('selected', String(opt.dataset.categoryColor || '').toLowerCase() === String(currentColor || '').toLowerCase());
        });

        // Close on click or touch outside
        const closeHandler = (evt) => {
            if (!menu.contains(evt.target)) {
                this.closeCategoryContextMenu();
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
        if (!this.requireWritableSite({ label: '创建商品分类' })) {
            return;
        }

        try {
            const result = await this.callAdminMutation('create_category', {
                name,
                color: '#6b9ece'
            });
            const createdCategory = result?.category || null;
            if (!createdCategory) {
                throw new Error('创建分类失败');
            }

            this.categoryData.push(createdCategory);
            this.categoryData.sort((a, b) => Number(a?.sort_order || 0) - Number(b?.sort_order || 0));
            await this.renderProductCategoryFilters();
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
            this.closeCategoryContextMenu();
            return;
        }

        this.renameCategory(key, newName.trim());
        this.closeCategoryContextMenu();
    },

    renameCategory: async function (oldKey, newName) {
        const cat = this.categoryData.find(c => c.name === oldKey || c.id === oldKey);
        if (!cat) return;

        if (!this.requireWritableSite({ label: '重命名商品分类' })) {
            return;
        }

        try {
            const result = await this.callAdminMutation('rename_category', {
                categoryId: cat.id,
                name: newName
            });
            const updatedCategory = result?.category || null;
            if (!updatedCategory) {
                throw new Error('重命名分类失败');
            }

            // Update local data
            cat.name = updatedCategory.name;
            this.allProductsForImport.forEach(p => {
                if (p.category === oldKey) p.category = newName;
            });
            if (this.currentImportCategory === oldKey) {
                this.currentImportCategory = newName;
            }
            if (this.currentCategory === oldKey) {
                this.currentCategory = newName;
            }

            await this.renderProductCategoryFilters();
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

        if (!this.requireWritableSite({ label: '设置商品分类颜色' })) {
            return;
        }

        this.closeCategoryContextMenu();

        try {
            const result = await this.callAdminMutation('set_category_color', {
                categoryId: cat.id,
                color
            });
            const updatedCategory = result?.category || null;
            if (!updatedCategory) {
                throw new Error('设置分类颜色失败');
            }

            cat.color = updatedCategory.color;
            this.renderImportList();
        } catch (e) {
            console.error('Failed to set color:', e);
            alert('设置颜色失败: ' + e.message);
        }
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
            this.closeCategoryContextMenu();
            return;
        }

        this.deleteCategory(cat);
        this.closeCategoryContextMenu();
    },

    deleteCategory: async function (cat) {
        if (!this.requireWritableSite({ label: '删除商品分类' })) {
            return;
        }

        try {
            const result = await this.callAdminMutation('delete_category', {
                categoryId: cat.id
            });
            const fallbackCategory = result?.fallbackCategory || 'other';

            // Update local data
            await this.loadCategories({ force: true });
            this.allProductsForImport.forEach(p => {
                if (p.category === cat.name) p.category = fallbackCategory;
            });
            if (this.currentImportCategory === cat.name) {
                this.currentImportCategory = 'all';
            }
            if (this.currentCategory === cat.name) {
                this.currentCategory = 'all';
            }

            await this.renderProductCategoryFilters();
            this.renderImportList();
        } catch (e) {
            console.error('Failed to delete category:', e);
            alert('删除失败: ' + e.message);
        }
    },

    // Move product to different category (Drag & Drop)
    moveProductToCategory: async function (productId, targetCategory) {
        if (!productId || !targetCategory) return;
        if (!this.requireWritableSite({ label: '移动商品分类' })) {
            return;
        }

        return this.reorderProduct(productId, targetCategory, null, {
            skipWritableSiteCheck: true
        });
    },

    selectImportProduct: function (id, name) {
        // Update hidden input
        document.getElementById('importViewProductId').value = id;

        // Update UI Badge
        const badge = document.getElementById('selectedProductBadge');
        badge.textContent = name;
        badge.classList.remove('admin-studio-inline-style-attr-3');

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
        if (!this.requireWritableSite({ label: '导入库存（工作台）' })) {
            return;
        }

        const productId = document.getElementById('importViewProductId').value;
        const content = document.getElementById('importViewContentInput').value;
        const status = document.querySelector('input[name="importViewStatus"]:checked').value;

        if (!productId) { alert('请先在左侧选择商品'); return; }
        if (!content.trim()) { alert('请输入账号内容'); return; }

        const contentLines = content.split('\n').map(l => l.trim()).filter(l => l);
        if (contentLines.length === 0) return;

        try {
            const { batchId, imported } = await this.performInventoryImport({
                productId,
                contentLines,
                status
            });
            alert(`成功导入 ${imported} 个账号\n批次号: ${batchId}`);

            // Clear input
            document.getElementById('importViewContentInput').value = '';
            document.getElementById('importViewLineCount').textContent = '(0个)';

            // Note: We don't clear selection so user can continue importing if needed.
            await this.loadProducts();
            await this.loadInventoryProductList();
            if (this.currentTab === 'inventory') {
                await this.loadInventoryList(this.inventoryPage);
            }

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
                if (menu) menu.classList.remove('is-open');

            } else {
                const result = await this.loadInventoryViaAdminApi(
                    {
                        ...this.getInventoryQueryFilters({ page: 1, pageSize: 10000, includeSearch: true }),
                        includeOrderHints: true
                    }
                );
                items = Array.isArray(result.items) ? result.items : [];
                const status = document.getElementById('invFilterStatus')?.value || null;
                const statusName = status ? {
                    reserve: '储备',
                    available: '在售',
                    sold: '已售',
                    frozen: '冻结',
                    fault: '故障'
                }[status] || status : '全部';
                filenamePrefix = `库存导出_${statusName}`;
            }

            if (items.length === 0) {
                alert('没有可导出的数据');
                return;
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
            const site = window.AdminSiteFilter?.getSiteFilter?.() || 'all';
            const query = String(document.getElementById('orderSearchInput')?.value || '').trim();
            const data = await this.loadAllOrdersForExport({
                site,
                pageSize: 100,
                query,
                refundStatus: this.normalizeOrderRefundStatusFilter(this.orderRefundStatusFilter),
                deliveryStatus: this.normalizeOrderDeliveryStatusFilter(this.orderDeliveryStatusFilter)
            });

            if (!data.length) {
                alert('没有可导出的订单');
                return;
            }

            const rows = data.map((o, idx) => {
                const profile = o.profiles || {};
                return {
                    '序号': idx + 1,
                    '订单号': o.id,
                    '商品': o.snapshot_product_name || o.resolved_items?.[0]?.product_name || '',
                    '支付积分': o.price_paid,
                    '买家邮箱': profile.email || '',
                    '退款状态': o.refund_status === 'refunded' ? '已退款' : '正常',
                    '下单时间': new Date(o.created_at).toLocaleString('zh-CN')
                };
            });

            const ws = XLSX.utils.json_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, '订单列表');
            const filenameSuffix = site === 'all' ? '全部' : site.toUpperCase();
            XLSX.writeFile(wb, `订单导出_${filenameSuffix}_${new Date().toISOString().slice(0, 10)}.xlsx`);
        } catch (err) {
            alert('导出失败: ' + err.message);
        }
    }
};

window.ShopAdmin = ShopAdmin;
