// ========================================
// ADMIN DISCOUNTS MODULE (Phase 2)
// Handles creation and management of Discount Codes
// ========================================

const AdminDiscounts = {
    discounts: [],
    filteredDiscounts: [],
    currentPage: 1,
    itemsPerPage: 10,
    controlsBound: false,
    restrictionOptionsLoaded: false,
    restrictionOptionsPromise: null,
    categories: [],
    products: [],
    categoryNameMap: new Map(),
    productNameMap: new Map(),
    filters: {
        status: 'all', // all, active, used (includes expired/inactive)
        search: ''
    },

    escapeHtml: function (value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    createTableStateRow: function ({ message, icon = 'fa-inbox', variant = 'empty', spinning = false }) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        const wrapper = document.createElement('div');
        const iconNode = document.createElement('i');
        const textNode = document.createElement('span');

        cell.colSpan = 6;
        cell.className = `empty-state admin-discount-table-state-cell admin-discount-table-state-cell--${variant}`;

        wrapper.className = 'admin-discount-table-state';
        iconNode.className = `fas ${icon}${spinning ? ' fa-spin' : ''} admin-discount-table-state-icon`;
        textNode.className = 'admin-discount-table-state-text';
        textNode.textContent = String(message ?? '暂无数据');

        wrapper.appendChild(iconNode);
        wrapper.appendChild(textNode);
        cell.appendChild(wrapper);
        row.appendChild(cell);
        return row;
    },

    buildTableLoadingSkeleton: function (rowCount = 6) {
        const rows = Math.max(4, Number.parseInt(rowCount, 10) || 6);
        const titleWidths = ['admin-skeleton-w-50', 'admin-skeleton-w-60', 'admin-skeleton-w-40'];
        const metaWidths = ['admin-skeleton-w-30', 'admin-skeleton-w-40'];

        return Array.from({ length: rows }, (_, index) => `
            <tr class="admin-table-skeleton-row admin-discount-table-skeleton-row" aria-hidden="true" data-skeleton-index="${index}">
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack">
                        <span class="admin-skeleton-block admin-skeleton-block--title ${titleWidths[index % titleWidths.length]}"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line ${metaWidths[index % metaWidths.length]}"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack">
                        <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-sm"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-40"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack">
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-60"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-40"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack">
                        <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-xs"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-30"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack">
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-70"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-50"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-actions">
                        <span class="admin-skeleton-block admin-skeleton-block--action"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--action"></span>
                    </div>
                </td>
            </tr>
        `).join('');
    },

    setGenerateModalVisible: function (visible) {
        const modal = document.getElementById('discountGenerateModal');
        if (!modal) return;
        modal.classList.toggle('is-visible', visible);
        modal.setAttribute('aria-hidden', visible ? 'false' : 'true');
    },

    setTypeDropdownOpen: function (open) {
        const dropdown = document.getElementById('discountTypeDropdown');
        if (!dropdown) return;
        dropdown.classList.toggle('is-open', open);
        dropdown.setAttribute('aria-hidden', open ? 'false' : 'true');
    },

    formatPercentDiscountValue: function (value) {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue) || numericValue <= 0) {
            return '--折';
        }

        const folded = numericValue / 10;
        return `${Number.isInteger(folded) ? folded : folded.toFixed(1).replace(/\.0$/, '')}折`;
    },

    getDiscountTypeMarkup: function (discount) {
        if (discount.discount_type === 'percent') {
            return `<span class="admin-discount-type-value admin-discount-type-value--percent">${this.formatPercentDiscountValue(discount.discount_value)}</span>`;
        }
        return `<span class="admin-discount-type-value admin-discount-type-value--fixed">立减 ${discount.discount_value} 积分</span>`;
    },

    normalizeScopeType: function (value) {
        if (value === 'category' || value === 'product') {
            return value;
        }
        return 'all';
    },

    getCategoryLabel: function (categoryId) {
        const normalized = String(categoryId ?? '').trim();
        if (!normalized) return '全部分类';
        return this.categoryNameMap.get(normalized) || normalized;
    },

    getProductLabel: function (productId) {
        const normalized = String(productId ?? '').trim();
        if (!normalized) return '全部商品';
        return this.productNameMap.get(normalized) || normalized;
    },

    getDiscountUsageMarkup: function (discount) {
        const totalLimit = Number.parseInt(discount.max_uses, 10);
        const perUserLimit = Number.parseInt(discount.max_uses_per_user, 10);
        const usageParts = [
            `<div class="admin-discount-usage-meta">已用: <span class="admin-discount-usage-count">${discount.used_count}</span> / ${totalLimit > 0 ? totalLimit : '∞'}</div>`
        ];

        if (perUserLimit > 0) {
            usageParts.push(`<div class="admin-discount-expiry-meta">每人最多 ${perUserLimit} 次</div>`);
        } else {
            usageParts.push('<div class="admin-discount-expiry-meta">每人不限次数</div>');
        }

        return usageParts.join('');
    },

    getDiscountPolicyMarkup: function (discount) {
        const policyLines = [];
        const applicableSite = String(discount.applicable_site ?? '').trim().toLowerCase();
        const scopeType = this.normalizeScopeType(discount.scope_type);

        policyLines.push(
            `<div class="admin-discount-expiry-meta"><i class="fas fa-earth-asia"></i> 站点: ${this.escapeHtml(applicableSite ? applicableSite.toUpperCase() : '全部')}</div>`
        );

        if (scopeType === 'category') {
            policyLines.push(
                `<div class="admin-discount-expiry-meta"><i class="fas fa-layer-group"></i> 分类: ${this.escapeHtml(this.getCategoryLabel(discount.scope_category))}</div>`
            );
        } else if (scopeType === 'product') {
            policyLines.push(
                `<div class="admin-discount-expiry-meta"><i class="fas fa-box-open"></i> 商品: ${this.escapeHtml(this.getProductLabel(discount.scope_product_id))}</div>`
            );
        } else {
            policyLines.push('<div class="admin-discount-expiry-meta"><i class="fas fa-tags"></i> 范围: 全部商品</div>');
        }

        if (discount.allow_zero_total) {
            policyLines.push('<div><span class="status-badge active"><i class="fas fa-unlock"></i> 允许全免</span></div>');
        } else {
            policyLines.push('<div><span class="admin-discount-status-muted"><i class="fas fa-shield-alt"></i> 禁止全免</span></div>');
        }

        return `<div class="admin-discount-status-stack">${policyLines.join('')}</div>`;
    },

    init: function () {
        console.log('🎟️ Initializing Discounts Module...');
        this.bindStaticControls();
        this.loadRestrictionOptions();
        this.loadDiscounts();
    },

    bindStaticControls: function () {
        if (this.controlsBound) {
            return;
        }
        this.controlsBound = true;

        const openBtn = document.querySelector('[data-admin-action="discounts-open-generate-modal"]');
        if (openBtn) {
            openBtn.addEventListener('click', async (event) => {
                event.preventDefault();
                event.stopPropagation();
                await this.openGenerateModal();
            });
        }

        const closeBtn = document.querySelector('[data-admin-action="discounts-close-generate-modal"]');
        if (closeBtn) {
            closeBtn.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.closeGenerateModal();
            });
        }

        const submitBtn = document.querySelector('[data-admin-action="discounts-submit-generate"]');
        if (submitBtn) {
            submitBtn.addEventListener('click', async (event) => {
                event.preventDefault();
                event.stopPropagation();
                await this.submitGenerate();
            });
        }

        const form = document.getElementById('discountGenerateForm');
        if (form) {
            form.addEventListener('submit', async (event) => {
                event.preventDefault();
                event.stopPropagation();
                await this.submitGenerate();
            });
        }

        const typeTrigger = document.getElementById('discountTypeTrigger');
        if (typeTrigger) {
            typeTrigger.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.toggleTypeDropdown();
            });
        }

        document.querySelectorAll('#discountTypeDropdown [data-admin-action="discounts-select-type"]').forEach((option) => {
            option.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.selectDiscountType(option.dataset.discountType);
            });
        });

        const scopeTypeSelect = document.getElementById('discountScopeType');
        if (scopeTypeSelect) {
            scopeTypeSelect.addEventListener('change', () => {
                this.toggleScopeFields();
            });
        }

        const modal = document.getElementById('discountGenerateModal');
        if (modal) {
            modal.addEventListener('click', (event) => {
                const target = event.target instanceof Element ? event.target : null;
                if (!target) {
                    return;
                }

                if (target === modal) {
                    event.preventDefault();
                    event.stopPropagation();
                    this.closeGenerateModal();
                }
            });
        }
    },

    ensureRestrictionOptionsLoaded: async function () {
        if (this.restrictionOptionsLoaded) {
            return;
        }

        if (!this.restrictionOptionsPromise) {
            this.restrictionOptionsPromise = this.loadRestrictionOptions();
        }

        await this.restrictionOptionsPromise;
    },

    loadRestrictionOptions: async function () {
        if (this.restrictionOptionsLoaded) {
            return;
        }

        this.restrictionOptionsPromise = (async () => {
            let productData = [];
            let categoryData = [];

            try {
                const [{ data: products, error: productsError }, { data: categories, error: categoriesError }] = await Promise.all([
                    supabaseClient
                        .from('shop_products')
                        .select('id, name, category')
                        .eq('is_active', true)
                        .order('display_order', { ascending: false }),
                    supabaseClient
                        .from('shop_categories')
                        .select('id, name, sort_order')
                        .order('sort_order', { ascending: true })
                ]);

                if (productsError) {
                    console.warn('Failed to load discount product restriction options:', productsError);
                } else if (Array.isArray(products)) {
                    productData = products;
                }

                if (categoriesError) {
                    console.warn('Failed to load discount category restriction options:', categoriesError);
                } else if (Array.isArray(categories)) {
                    categoryData = categories;
                }
            } catch (err) {
                console.warn('Failed to load discount restriction options:', err);
            }

            if (categoryData.length === 0 && productData.length > 0) {
                const seenCategories = new Set();
                categoryData = productData
                    .map((product) => String(product.category ?? '').trim())
                    .filter((categoryId) => {
                        if (!categoryId || seenCategories.has(categoryId)) {
                            return false;
                        }
                        seenCategories.add(categoryId);
                        return true;
                    })
                    .map((categoryId, index) => ({
                        id: categoryId,
                        name: categoryId,
                        sort_order: index
                    }));
            }

            this.products = productData;
            this.categories = categoryData;
            this.productNameMap = new Map(productData.map((product) => [String(product.id), product.name || String(product.id)]));
            this.categoryNameMap = new Map();
            categoryData.forEach((category) => {
                const categoryId = String(category.id ?? '').trim();
                const categoryName = String(category.name ?? category.id ?? '').trim();
                if (categoryId) {
                    this.categoryNameMap.set(categoryId, categoryName || categoryId);
                }
                if (categoryName) {
                    this.categoryNameMap.set(categoryName, categoryName);
                }
            });
            this.populateRestrictionSelects();
            this.restrictionOptionsLoaded = true;

            if (this.discounts.length > 0) {
                this.render();
            }
        })();

        try {
            await this.restrictionOptionsPromise;
        } finally {
            this.restrictionOptionsPromise = null;
        }
    },

    populateRestrictionSelects: function () {
        const categorySelect = document.getElementById('discountScopeCategory');
        const productSelect = document.getElementById('discountScopeProduct');

        if (categorySelect) {
            const currentValue = categorySelect.value;
            categorySelect.innerHTML = [
                '<option value="">请选择分类</option>',
                ...this.categories.map((category) => {
                    const categoryName = String(category.name ?? category.id ?? '').trim();
                    return `<option value="${this.escapeHtml(categoryName)}">${this.escapeHtml(categoryName || String(category.id))}</option>`;
                })
            ].join('');

            if (currentValue && this.categories.some((category) => String(category.name ?? category.id ?? '').trim() === currentValue)) {
                categorySelect.value = currentValue;
            }
        }

        if (productSelect) {
            const currentValue = productSelect.value;
            productSelect.innerHTML = [
                '<option value="">请选择商品</option>',
                ...this.products.map((product) => `<option value="${this.escapeHtml(String(product.id))}">${this.escapeHtml(product.name || String(product.id))}</option>`)
            ].join('');

            if (currentValue && this.products.some((product) => String(product.id) === currentValue)) {
                productSelect.value = currentValue;
            }
        }
    },

    toggleScopeFields: function () {
        const scopeType = this.normalizeScopeType(document.getElementById('discountScopeType')?.value);
        const categoryWrapper = document.getElementById('discountScopeCategoryWrapper');
        const productWrapper = document.getElementById('discountScopeProductWrapper');
        const categorySelect = document.getElementById('discountScopeCategory');
        const productSelect = document.getElementById('discountScopeProduct');

        if (categoryWrapper) {
            categoryWrapper.hidden = scopeType !== 'category';
        }
        if (productWrapper) {
            productWrapper.hidden = scopeType !== 'product';
        }

        if (scopeType !== 'category' && categorySelect) {
            categorySelect.value = '';
        }
        if (scopeType !== 'product' && productSelect) {
            productSelect.value = '';
        }
    },

    // ----------------------------------------
    // DATA LOADING & RENDERING
    // ----------------------------------------
    loadDiscounts: async function () {
        const tableBody = document.getElementById('discountsTableBody');
        if (!tableBody) return;

        tableBody.innerHTML = this.buildTableLoadingSkeleton();

        try {
            const { data, error } = await supabaseClient
                .from('discount_codes')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;

            // Optional: apply site filter if discount_codes had a 'site' column, 
            // but these are likely global for now.
            this.discounts = data || [];
            this.render();

        } catch (err) {
            console.error('Failed to load discounts:', err);
            tableBody.replaceChildren(this.createTableStateRow({
                message: `加载失败: ${err.message}`,
                icon: 'fa-circle-exclamation',
                variant: 'error'
            }));
        }
    },

    search: function () {
        const input = document.getElementById('discountSearchInput');
        if (input) {
            this.filters.search = input.value.trim().toLowerCase();
            this.currentPage = 1;
            this.render();
        }
    },

    filter: function (status, btnElement) {
        this.filters.status = status;
        this.currentPage = 1;

        // Update active class on buttons
        const controls = document.querySelector('#module-discounts .filter-dropdowns');
        if (controls) {
            controls.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            if (btnElement) btnElement.classList.add('active');
        }

        this.render();
    },

    render: function () {
        const { status, search } = this.filters;
        const now = new Date();

        // 1. Filter
        this.filteredDiscounts = this.discounts.filter(d => {
            // Search by code
            let matchSearch = true;
            if (search) {
                matchSearch = d.code.toLowerCase().includes(search);
            }

            // Determine if it is practically usable
            const isPracticallyUsed = !d.is_active ||
                (d.max_uses > 0 && d.used_count >= d.max_uses) ||
                (d.expires_at && new Date(d.expires_at) < now);

            // Status filter
            let matchStatus = true;
            if (status === 'active') matchStatus = !isPracticallyUsed;
            if (status === 'used') matchStatus = isPracticallyUsed;

            return matchSearch && matchStatus;
        });

        // 2. Pagination
        const totalItems = this.filteredDiscounts.length;
        const totalPages = Math.ceil(totalItems / this.itemsPerPage) || 1;

        if (this.currentPage > totalPages) {
            this.currentPage = totalPages;
        }

        const tableBody = document.getElementById('discountsTableBody');
        if (!tableBody) return;

        if (this.filteredDiscounts.length === 0) {
            tableBody.replaceChildren(this.createTableStateRow({
                message: '未找到匹配的优惠券',
                icon: 'fa-inbox',
                variant: 'empty'
            }));
            const pContainer = document.getElementById('discountsPagination');
            if (pContainer) pContainer.innerHTML = '';
            return;
        }

        const startIndex = (this.currentPage - 1) * this.itemsPerPage;
        const endIndex = startIndex + this.itemsPerPage;
        const paginatedDiscounts = this.filteredDiscounts.slice(startIndex, endIndex);

        // Render rows
        tableBody.innerHTML = paginatedDiscounts.map(d => {
            const isExpired = d.expires_at && new Date(d.expires_at) < now;
            const isExhausted = d.max_uses > 0 && d.used_count >= d.max_uses;
            const isPracticallyUsed = !d.is_active || isExpired || isExhausted;
            const escapedCode = this.escapeHtml(d.code);
            const escapedId = this.escapeHtml(d.id);
            const nextActiveState = (!d.is_active).toString();
            const typeLabel = this.getDiscountTypeMarkup(d);

            // Status Badge
            let statusBadge = '<span class="status-badge active"><i class="fas fa-check-circle"></i> 生效中</span>';
            if (!d.is_active) statusBadge = '<span class="status-badge banned"><i class="fas fa-ban"></i> 已停用</span>';
            else if (isExpired) statusBadge = '<span class="status-badge away"><i class="fas fa-clock"></i> 已过期</span>';
            else if (isExhausted) statusBadge = '<span class="admin-discount-status-muted"><i class="fas fa-check-double"></i> 被抢光</span>';

            // Min Order
            /* Usually you'd have min_order amount, if not in DB schema, we might not render it initially,
             but since we put it in the UI, if the DB doesn't have it, we just show "无门槛". 
             (Wait, schema didn't show 'min_order_amount', but let's assume it defaults 0 if added later or just ignore) */

            return `
            <tr class="${isPracticallyUsed ? 'opacity-70' : ''}">
                <td>
                    <button type="button"
                        class="admin-discount-code-btn"
                        data-admin-action="discounts-copy-code"
                        data-discount-code="${escapedCode}"
                        title="点击复制">
                        ${escapedCode}
                    </button>
                </td>
                <td>${typeLabel}</td>
                <td>
                    ${this.getDiscountUsageMarkup(d)}
                </td>
                <td>
                    <div class="admin-discount-status-stack">
                        <div>${statusBadge}</div>
                        ${d.expires_at ? `<div class="admin-discount-expiry-meta">截止: ${new Date(d.expires_at).toLocaleDateString()}</div>` : '<div class="admin-discount-expiry-meta">永久有效</div>'}
                    </div>
                </td>
                <td>${this.getDiscountPolicyMarkup(d)}</td>
                <td>
                    <div class="action-buttons admin-discount-action-wrap">
                        <button class="action-btn ${d.is_active ? 'warning' : 'success'}"
                                type="button"
                                data-admin-action="discounts-toggle-status"
                                data-discount-id="${escapedId}"
                                data-discount-next-active="${nextActiveState}"
                                title="${d.is_active ? '停用' : '启用'}">
                            <i class="fas ${d.is_active ? 'fa-ban' : 'fa-check'}"></i>
                        </button>
                        <button class="action-btn danger"
                                type="button"
                                data-admin-action="discounts-delete-code"
                                data-discount-id="${escapedId}"
                                data-discount-code="${escapedCode}"
                                title="删除">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    </div>
                </td>
            </tr>`;
        }).join('');

        this.renderPagination(totalPages);
    },

    goToPage: function (page) {
        this.currentPage = page;
        this.render();
    },

    renderPagination: function (totalPages) {
        const pContainer = document.getElementById('discountsPagination');
        if (!pContainer) return;

        if (this.filteredDiscounts.length === 0) {
            pContainer.innerHTML = '';
            return;
        }

        pContainer.innerHTML = `
            <div class="admin-discount-pagination-shell">
                <div class="pagination-control">
                    <button class="pagination-btn"
                        type="button"
                        data-admin-action="discounts-pagination-go"
                        data-discount-page="${Math.max(this.currentPage - 1, 1)}"
                        ${this.currentPage <= 1 ? 'disabled' : ''}>−</button>
                    <input type="number" class="pagination-input" value="${this.currentPage}" min="1" max="${totalPages}"
                        data-admin-change-action="discounts-pagination-go">
                    <button class="pagination-btn"
                        type="button"
                        data-admin-action="discounts-pagination-go"
                        data-discount-page="${Math.min(this.currentPage + 1, totalPages)}"
                        ${this.currentPage >= totalPages ? 'disabled' : ''}>+</button>
                </div>
                <div class="pagination-total pagination-total--compact">共 ${totalPages} 页 / ${this.filteredDiscounts.length} 条</div>
            </div>
        `;
    },

    copyCode: function (code) {
        navigator.clipboard.writeText(code).then(() => {
            let toast = document.getElementById('discountCopyToast');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'discountCopyToast';
                toast.className = 'admin-discount-copy-toast';
                document.body.appendChild(toast);
            }
            toast.innerHTML = '<i class="fas fa-check-circle admin-discount-copy-toast-icon"></i><span>已复制</span>';
            toast.classList.add('is-visible');
            clearTimeout(toast._timer);
            toast._timer = setTimeout(() => {
                toast.classList.remove('is-visible');
            }, 2000);
        });
    },

    // ----------------------------------------
    // ACTIONS (TOGGLE, DELETE)
    // ----------------------------------------
    toggleStatus: async function (id, newState) {
        if (!confirm(`确定要${newState ? '启用' : '停用'}该优惠码吗？`)) return;

        try {
            const { error } = await supabaseClient
                .from('discount_codes')
                .update({ is_active: newState })
                .eq('id', id);

            if (error) throw error;
            await this.loadDiscounts();
        } catch (err) {
            alert('操作失败: ' + err.message);
        }
    },

    deleteCode: async function (id, code) {
        if (!confirm(`警告：确定要永久删除优惠码 "${code}" 吗？这可能影响历史订单的关联显示。建议使用"停用"功能。`)) return;

        try {
            const { error } = await supabaseClient
                .from('discount_codes')
                .delete()
                .eq('id', id);

            if (error) throw error;
            await this.loadDiscounts();
        } catch (err) {
            alert('删除失败: ' + err.message);
        }
    },

    // ----------------------------------------
    // GENERATE MODAL
    // ----------------------------------------
    openGenerateModal: async function () {
        await this.ensureRestrictionOptionsLoaded();
        document.getElementById('discountGenerateForm').reset();
        document.getElementById('discountCodeInput').value = '';
        document.getElementById('discountApplicableSite').value = '';
        document.getElementById('discountMaxUsesPerUser').value = '0';
        document.getElementById('discountScopeType').value = 'all';
        document.getElementById('discountScopeCategory').value = '';
        document.getElementById('discountScopeProduct').value = '';
        document.getElementById('discountAllowZeroTotal').checked = false;
        this.selectDiscountType('percent');
        this.toggleScopeFields();
        this.setGenerateModalVisible(true);
    },

    closeGenerateModal: function () {
        this.setTypeDropdownOpen(false);
        this.setGenerateModalVisible(false);
    },

    toggleTypeDropdown: function () {
        const dropdown = document.getElementById('discountTypeDropdown');
        if (!dropdown) return;
        this.setTypeDropdownOpen(!dropdown.classList.contains('is-open'));
    },

    selectDiscountType: function (type) {
        const isFixed = type === 'fixed';
        const label = document.getElementById('discountTypeLabel');
        const valueType = document.getElementById('discountValueType');
        const dropdown = document.getElementById('discountTypeDropdown');
        const suffix = document.getElementById('discountValueSuffix');
        const valueInput = document.getElementById('discountValue');

        if (valueType) {
            valueType.value = isFixed ? 'fixed' : 'percent';
        }

        if (label) {
            label.innerHTML = isFixed
                ? '<span class="admin-discount-type-label-icon">💰</span> 固定金额立减'
                : '<span class="admin-discount-type-label-icon">📊</span> 按比例打折';
        }

        if (suffix) {
            suffix.innerText = isFixed ? '积分' : '折';
        }

        if (valueInput) {
            valueInput.placeholder = isFixed ? '如: 100' : '如: 80';
        }

        this.setTypeDropdownOpen(false);
    },

    formatExpiryDateInput: function (input) {
        if (!input) return;
        let value = String(input.value || '').replace(/[^0-9]/g, '');
        if (value.length > 4) value = `${value.slice(0, 4)}-${value.slice(4)}`;
        if (value.length > 7) value = `${value.slice(0, 7)}-${value.slice(7)}`;
        input.value = value.slice(0, 10);
    },

    formatExpiryTimeInput: function (input) {
        if (!input) return;
        let value = String(input.value || '').replace(/[^0-9]/g, '');
        if (value.length > 2) value = `${value.slice(0, 2)}:${value.slice(2)}`;
        input.value = value.slice(0, 5);
    },

    generateRandomCode: function (length = 8) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    },

    submitGenerate: async function () {
        let code = document.getElementById('discountCodeInput').value.trim().toUpperCase();
        if (!code) {
            code = this.generateRandomCode();
        }

        const type = document.getElementById('discountValueType').value;
        const value = parseInt(document.getElementById('discountValue').value);
        if (!value || value <= 0) {
            alert('请输入有效的优惠券面额');
            return;
        }

        if (type === 'percent' && value > 100) {
            alert('折扣比例不能大于 100，例如 80 表示 8 折');
            return;
        }

        const maxUses = parseInt(document.getElementById('discountMaxUses').value) || 0;
        const maxUsesPerUser = parseInt(document.getElementById('discountMaxUsesPerUser').value) || 0;
        if (maxUsesPerUser < 0) {
            alert('每用户最多使用次数不能小于 0');
            return;
        }

        const applicableSiteRaw = String(document.getElementById('discountApplicableSite')?.value || '').trim().toLowerCase();
        const applicableSite = applicableSiteRaw || null;
        if (applicableSite && !['cn', 'intl'].includes(applicableSite)) {
            alert('适用站点配置无效');
            return;
        }

        const scopeType = this.normalizeScopeType(document.getElementById('discountScopeType')?.value);
        const scopeCategory = scopeType === 'category'
            ? String(document.getElementById('discountScopeCategory')?.value || '').trim()
            : null;
        const scopeProductId = scopeType === 'product'
            ? String(document.getElementById('discountScopeProduct')?.value || '').trim()
            : null;

        if (scopeType === 'category' && !scopeCategory) {
            alert('请选择优惠券适用的分类');
            return;
        }

        if (scopeType === 'product' && !scopeProductId) {
            alert('请选择优惠券适用的商品');
            return;
        }

        const allowZeroTotal = !!document.getElementById('discountAllowZeroTotal')?.checked;
        const expiryRaw = (document.getElementById('discountExpiryDate') || {}).value || '';
        const expiryTime = (document.getElementById('discountExpiryTime') || {}).value || '23:59';
        let expires_at = null;
        if (expiryRaw.trim()) {
            try { expires_at = new Date(expiryRaw.trim() + 'T' + (expiryTime.trim() || '23:59')).toISOString(); } catch (e) { expires_at = null; }
        }

        const payload = {
            code: code,
            discount_type: type,
            discount_value: value,
            max_uses: maxUses,
            max_uses_per_user: maxUsesPerUser,
            expires_at: expires_at,
            applicable_site: applicableSite,
            scope_type: scopeType,
            scope_category: scopeCategory,
            scope_product_id: scopeProductId,
            allow_zero_total: allowZeroTotal,
            is_active: true
        };

        try {
            const { data, error } = await supabaseClient
                .from('discount_codes')
                .insert([payload]);

            if (error) {
                if (error.code === '23505') throw new Error('该优惠码已存在，请换一个名称');
                throw error;
            }

            this.closeGenerateModal();
            alert(`成功生成优惠码: ${code}`);
            this.loadDiscounts();

        } catch (err) {
            alert('生成失败: ' + err.message);
        }
    }
};

// Auto-attach to window so admin-studio.html can find it
window.AdminDiscounts = AdminDiscounts;
