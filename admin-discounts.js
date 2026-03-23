// ========================================
// ADMIN DISCOUNTS MODULE (Phase 2)
// Handles creation and management of Discount Codes
// ========================================

const AdminDiscounts = {
    discounts: [],
    filteredDiscounts: [],
    currentPage: 1,
    itemsPerPage: 10,
    filters: {
        status: 'all', // all, active, used (includes expired/inactive)
        search: ''
    },

    init: function () {
        console.log('🎟️ Initializing Discounts Module...');
        this.loadDiscounts();
    },

    // ----------------------------------------
    // DATA LOADING & RENDERING
    // ----------------------------------------
    loadDiscounts: async function () {
        const tableBody = document.getElementById('discountsTableBody');
        if (!tableBody) return;

        tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-dim);padding:20px;">
            <i class="fas fa-spinner fa-spin"></i> 加载中...
        </td></tr>`;

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
            tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#ef4444;padding:20px;">
                加载失败: ${err.message}
            </td></tr>`;
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
            tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-dim);height:300px;vertical-align:middle;">
                <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%;">
                    <i class="fas fa-inbox" style="font-size:32px;margin-bottom:16px;opacity:0.5;"></i>
                    <span>未找到匹配的优惠券</span>
                </div>
            </td></tr>`;
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

            const typeLabel = d.discount_type === 'percent'
                ? `<span style="color:#60a5fa;font-weight:600;">${100 - d.discount_value}折</span>`
                : `<span style="color:#f59e0b;font-weight:600;">立减 ${d.discount_value} 积分</span>`;

            // Status Badge
            let statusBadge = '<span class="status-badge active"><i class="fas fa-check-circle"></i> 生效中</span>';
            if (!d.is_active) statusBadge = '<span class="status-badge banned"><i class="fas fa-ban"></i> 已停用</span>';
            else if (isExpired) statusBadge = '<span class="status-badge away"><i class="fas fa-clock"></i> 已过期</span>';
            else if (isExhausted) statusBadge = '<span style="color:#94a3b8;"><i class="fas fa-check-double"></i> 被抢光</span>';

            // Min Order
            /* Usually you'd have min_order amount, if not in DB schema, we might not render it initially,
             but since we put it in the UI, if the DB doesn't have it, we just show "无门槛". 
             (Wait, schema didn't show 'min_order_amount', but let's assume it defaults 0 if added later or just ignore) */

            return `
            <tr class="${isPracticallyUsed ? 'opacity-70' : ''}">
                <td>
                    <span style="font-family:'SF Mono',Consolas,monospace; font-size:14px; font-weight:500; letter-spacing:0.5px; color:#e8edf4; cursor:pointer; transition:color 0.2s;" onclick="AdminDiscounts.copyCode('${d.code}')" title="点击复制">
                        ${d.code}
                    </span>
                </td>
                <td>${typeLabel}</td>
                <td>
                    <div style="font-size:13px;">已用: <span style="color:#fff">${d.used_count}</span> / ${d.max_uses || '∞'}</div>
                </td>
                <td>
                    <div style="display:inline-flex; flex-direction:column; align-items:center;">
                        <div>${statusBadge}</div>
                        ${d.expires_at ? `<div style="font-size:11px; color:var(--text-dim); margin-top:4px;">截止: ${new Date(d.expires_at).toLocaleDateString()}</div>` : '<div style="font-size:11px; color:var(--text-dim); margin-top:4px;">永久有效</div>'}
                    </div>
                </td>
                <td>
                    <div class="action-buttons" style="display: flex; justify-content: center; gap: 8px;">
                        <button class="action-btn ${d.is_active ? 'warning' : 'success'}" 
                                onclick="AdminDiscounts.toggleStatus('${d.id}', ${!d.is_active})" 
                                title="${d.is_active ? '停用' : '启用'}">
                            <i class="fas ${d.is_active ? 'fa-ban' : 'fa-check'}"></i>
                        </button>
                        <button class="action-btn danger" onclick="AdminDiscounts.deleteCode('${d.id}', '${d.code}')" title="删除">
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
            <div style="display: flex; align-items: center; justify-content: center; gap: 15px; margin-top: 20px;">
                <div class="pagination-control">
                    <button class="pagination-btn" onclick="AdminDiscounts.goToPage(${this.currentPage - 1})" ${this.currentPage <= 1 ? 'disabled' : ''}>−</button>
                    <input type="number" class="pagination-input" value="${this.currentPage}" min="1" max="${totalPages}"
                        onchange="AdminDiscounts.goToPage(parseInt(this.value)||1)">
                    <button class="pagination-btn" onclick="AdminDiscounts.goToPage(${this.currentPage + 1})" ${this.currentPage >= totalPages ? 'disabled' : ''}>+</button>
                </div>
                <div class="pagination-total" style="margin:0;">共 ${totalPages} 页 / ${this.filteredDiscounts.length} 条</div>
            </div>
        `;
    },

    copyCode: function (code) {
        navigator.clipboard.writeText(code).then(() => {
            // Show a sleek toast notification
            let toast = document.getElementById('discountCopyToast');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'discountCopyToast';
                toast.style.cssText = 'position:fixed; bottom:40px; left:50%; transform:translateX(-50%) translateY(20px); background:rgba(20,28,44,0.95); color:#e8edf4; padding:12px 24px; border-radius:12px; font-size:0.9rem; z-index:99999; opacity:0; transition:all 0.3s ease; border:1px solid rgba(255,255,255,0.1); box-shadow:0 8px 30px rgba(0,0,0,0.4); display:flex; align-items:center; gap:10px; pointer-events:none;';
                document.body.appendChild(toast);
            }
            toast.innerHTML = '<i class="fas fa-check-circle" style="color:#4ade80;"></i> 已复制';
            toast.style.opacity = '1';
            toast.style.transform = 'translateX(-50%) translateY(0)';
            clearTimeout(toast._timer);
            toast._timer = setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transform = 'translateX(-50%) translateY(20px)';
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
        this.selectDiscountType('percent');
        const modal = document.getElementById('discountGenerateModal');
        modal.style.display = 'flex';
        // Override CSS .modal-overlay defaults (opacity:0, visibility:hidden)
        requestAnimationFrame(() => {
            modal.style.opacity = '1';
            modal.style.visibility = 'visible';
        });
    },

    closeGenerateModal: function () {
        const modal = document.getElementById('discountGenerateModal');
        if (!modal) return;

        modal.style.opacity = '0';
        modal.style.visibility = 'hidden';
        setTimeout(() => {
            modal.style.display = 'none';
        }, 200);
    },

    toggleTypeDropdown: function () {
        const dropdown = document.getElementById('discountTypeDropdown');
        if (!dropdown) return;
        dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
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
                ? '<span style="font-size:1rem">💰</span> 固定金额立减'
                : '<span style="font-size:1rem">📊</span> 按比例打折';
        }

        if (suffix) {
            suffix.innerText = isFixed ? '积分' : '折';
        }

        if (valueInput) {
            valueInput.placeholder = isFixed ? '如: 100' : '如: 80';
        }

        if (dropdown) {
            dropdown.style.display = 'none';
        }
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
            alert('请输入有效的优惠卷面额');
            return;
        }

        const maxUses = parseInt(document.getElementById('discountMaxUses').value) || 0;
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
