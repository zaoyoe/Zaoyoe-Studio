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

    getDiscountPolicyMarkup: function (discount) {
        if (discount.allow_zero_total) {
            return '<span class="status-badge active"><i class="fas fa-unlock"></i> 允许全免</span>';
        }
        return '<span class="admin-discount-status-muted"><i class="fas fa-shield-alt"></i> 禁止全免</span>';
    },

    init: function () {
        console.log('🎟️ Initializing Discounts Module...');
        this.bindStaticControls();
        this.loadDiscounts();
    },

    bindStaticControls: function () {
        if (this.controlsBound) {
            return;
        }
        this.controlsBound = true;

        const openBtn = document.querySelector('[data-admin-action="discounts-open-generate-modal"]');
        if (openBtn) {
            openBtn.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.openGenerateModal();
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

    // ----------------------------------------
    // DATA LOADING & RENDERING
    // ----------------------------------------
    loadDiscounts: async function () {
        const tableBody = document.getElementById('discountsTableBody');
        if (!tableBody) return;

        tableBody.replaceChildren(this.createTableStateRow({
            message: '加载中...',
            icon: 'fa-spinner',
            variant: 'loading',
            spinning: true
        }));

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
                    <div class="admin-discount-usage-meta">已用: <span class="admin-discount-usage-count">${d.used_count}</span> / ${d.max_uses || '∞'}</div>
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
    openGenerateModal: function () {
        document.getElementById('discountGenerateForm').reset();
        document.getElementById('discountCodeInput').value = '';
        document.getElementById('discountAllowZeroTotal').checked = false;
        this.selectDiscountType('percent');
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
            expires_at: expires_at,
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
