/**
 * Admin Site Filter - 管理后台站点过滤器
 * 提供全局站点选择下拉框，所有管理模块共用
 */

(function () {
    'use strict';

    const VALID_SITE_FILTERS = new Set(['all', 'cn', 'intl']);

    // Current admin site filter: 'all' | 'cn' | 'intl'
    let currentFilter = normalizeSiteFilterValue(localStorage.getItem('admin_site_filter'));

    const SITE_LABELS = {
        all: '🌐 全部',
        cn: 'CN',
        intl: 'EN'
    };
    const WRITABLE_ACTION_LABELS = Object.freeze({
        'comments-batch-delete': '批量删除评论',
        'gallery-batch-add-homepage': '批量加入首页精选',
        'gallery-batch-localize': '批量补全 Prompt 双语',
        'gallery-batch-set-status': '批量更新 Prompt 运营状态',
        'homepage-save-section': '保存首页分区',
        'payments-handle-anomaly-action': '执行支付异常处理',
        'points-batch-invalidate': '批量作废兑换码',
        'points-batch-delete': '批量删除积分批次',
        'discounts-delete-code': '删除折扣码',
        'discounts-submit-generate': '生成折扣码'
    });
    const WRITABLE_FORM_LABELS = Object.freeze({
        promptForm: '保存 Prompt',
        generateCodesForm: '生成兑换码',
        discountGenerateForm: '生成折扣码'
    });

    function normalizeSiteFilterValue(value) {
        const normalized = String(value || '').trim().toLowerCase();
        return VALID_SITE_FILTERS.has(normalized) ? normalized : 'all';
    }

    function isAllSitesSelected() {
        return currentFilter === 'all';
    }

    function getWritableSite() {
        return isAllSitesSelected() ? null : currentFilter;
    }

    function actionRequiresWritableSite(action) {
        return Object.prototype.hasOwnProperty.call(WRITABLE_ACTION_LABELS, String(action || '').trim());
    }

    function formRequiresWritableSite(formId) {
        return Object.prototype.hasOwnProperty.call(WRITABLE_FORM_LABELS, String(formId || '').trim());
    }

    function getWritableGuardLabel(options = {}) {
        const action = String(options.action || '').trim();
        if (action && actionRequiresWritableSite(action)) {
            return WRITABLE_ACTION_LABELS[action];
        }

        const formId = String(options.formId || '').trim();
        if (formId && formRequiresWritableSite(formId)) {
            return WRITABLE_FORM_LABELS[formId];
        }

        return String(options.label || '').trim();
    }

    function notifyWritableSiteRequired(message) {
        if (typeof window.showToast === 'function') {
            window.showToast(message, 'warning');
            return;
        }

        console.warn(`[AdminSiteFilter] ${message}`);
    }

    function requireWritableSite(options = {}) {
        const writableSite = getWritableSite();
        if (writableSite) {
            return writableSite;
        }

        if (options.notify === false) {
            return null;
        }

        const label = getWritableGuardLabel(options);
        const message = String(options.message || '').trim()
            || (label
                ? `请先选择 CN 或 EN 站点后再执行「${label}」`
                : '请先选择 CN 或 EN 站点后再执行当前操作');
        notifyWritableSiteRequired(message);
        return null;
    }

    /**
     * Get the current admin site filter value
     * @returns {'all' | 'cn' | 'intl'}
     */
    function getSiteFilter() {
        return currentFilter;
    }

    /**
     * Apply site filter to a Supabase query builder
     * If filter is 'all', no filter is applied (returns original query)
     * @param {object} query - Supabase query builder
     * @param {string} column - Column name to filter on (default: 'site')
     * @returns {object} Modified or original query
     */
    function applySiteFilter(query, column = 'site') {
        if (currentFilter === 'all') return query;
        return query.eq(column, currentFilter);
    }

    /**
     * Get the current filter for use in RPC params
     * Returns null if 'all' (meaning don't filter by site)
     * @returns {string|null}
     */
    function getSiteParam() {
        return currentFilter === 'all' ? null : currentFilter;
    }

    function isAnalyticsModuleId(moduleId = '') {
        const normalized = String(moduleId || '').trim().toLowerCase();
        return normalized === 'analytics'
            || normalized === 'business-overview'
            || normalized === 'growth-center'
            || normalized === 'commerce-center';
    }

    /**
     * Render the site filter dropdown into target element
     */
    function renderSiteSelector() {
        const container = document.getElementById('adminSiteFilter');
        if (!container) return;

        container.innerHTML = `
            <div class="admin-site-selector" id="adminSiteSelector">
                <button class="site-selector-btn" type="button" data-admin-action="site-filter-toggle-dropdown">
                    <span class="site-selector-label">${SITE_LABELS[currentFilter]}</span>
                    <i class="fas fa-chevron-down"></i>
                </button>
                <div class="site-selector-menu" id="siteSelectorMenu">
                    ${Object.entries(SITE_LABELS).map(([key, label]) => `
                        <button type="button" class="site-selector-option ${key === currentFilter ? 'active' : ''}" 
                             data-admin-action="site-filter-select"
                             data-site-filter-value="${key}">
                            ${label}
                        </button>
                    `).join('')}
                </div>
            </div>
        `;
    }

    function toggleDropdown() {
        const menu = document.getElementById('siteSelectorMenu');
        if (menu) menu.classList.toggle('show');
    }

    function select(value) {
        currentFilter = normalizeSiteFilterValue(value);
        localStorage.setItem('admin_site_filter', currentFilter);

        if (typeof window.clearPendingPointsBatchOpen === 'function') {
            window.clearPendingPointsBatchOpen();
        }
        if (typeof window.closeCodesModal === 'function' && String(window.currentViewBatchId || '').trim()) {
            window.closeCodesModal();
            window.__pointsSiteChangeClosedBatchDetail = true;
        } else {
            window.__pointsSiteChangeClosedBatchDetail = false;
        }

        // Close dropdown
        const menu = document.getElementById('siteSelectorMenu');
        if (menu) menu.classList.remove('show');

        // Update button label
        const label = document.querySelector('.site-selector-label');
        if (label) label.textContent = SITE_LABELS[currentFilter];

        // Update active state
        document.querySelectorAll('.site-selector-option').forEach(opt => {
            opt.classList.toggle('active', opt.textContent.trim() === SITE_LABELS[currentFilter].trim());
        });

        const changeDetail = {
            site: currentFilter,
            writableSite: getWritableSite(),
            isAllSitesSelected: isAllSitesSelected()
        };

        // Dispatch custom event for modules that still subscribe directly.
        window.dispatchEvent(new CustomEvent('admin-site-changed', {
            detail: changeDetail
        }));

        // Prefer the P1 Admin Shell site-change bus; keep the legacy reload path as a safe fallback.
        if (window.AdminShell?.handleSiteChange?.(changeDetail) !== true) {
            reloadCurrentModule();
        }
    }

    function reloadCurrentModule() {
        const activeModule = document.querySelector('.module-container.active');
        if (!activeModule) return;

        const moduleId = activeModule.id.replace('module-', '');

        if (isAnalyticsModuleId(moduleId)) {
            if (typeof window.reloadAnalyticsDashboard === 'function') {
                window.reloadAnalyticsDashboard({ reason: 'site-change' });
            } else if (typeof window.initAnalyticsModule === 'function') {
                window.initAnalyticsModule();
            }
            return;
        }

        // Call appropriate reload function based on active module
        switch (moduleId) {
            case 'users':
                if (typeof window.loadUsers === 'function') window.loadUsers();
                break;
            case 'shop':
                if (window.ShopAdmin) {
                    if (typeof window.ShopAdmin.handleSiteChange === 'function') {
                        window.ShopAdmin.handleSiteChange();
                    } else {
                        if (typeof ShopAdmin.searchOrders === 'function') ShopAdmin.searchOrders();
                        if (typeof ShopAdmin.loadProducts === 'function') ShopAdmin.loadProducts();
                    }
                }
                break;
            case 'points':
                if (typeof window.clearPendingPointsBatchOpen === 'function') {
                    window.clearPendingPointsBatchOpen();
                }
                if (typeof window.closeCodesModal === 'function' && String(window.currentViewBatchId || '').trim()) {
                    window.closeCodesModal();
                }
                if (typeof window.loadBatches === 'function') window.loadBatches();
                break;
            case 'payments':
                if (window.AdminPayments && typeof window.AdminPayments.reload === 'function') {
                    window.AdminPayments.reload();
                }
                break;
            case 'comments':
                if (typeof window.loadComments === 'function') {
                    const view = window.currentCommentView || 'guestbook';
                    window.loadComments(view);
                }
                if (typeof window.loadCommentStats === 'function') window.loadCommentStats();
                break;
            case 'gallery':
                if (typeof window.handleAdminGallerySiteChange === 'function') {
                    window.handleAdminGallerySiteChange();
                } else if (typeof window.loadAdminPrompts === 'function') {
                    window.loadAdminPrompts();
                }
                break;
            case 'chat':
                // Re-initialize chat to reload sessions with new filter
                if (window.AdminChat) {
                    const chatContainer = document.getElementById('chat-admin-container');
                    if (chatContainer) new AdminChat(chatContainer);
                }
                break;
        }
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#adminSiteSelector')) {
            const menu = document.getElementById('siteSelectorMenu');
            if (menu) menu.classList.remove('show');
        }
    });

    // Export
    window.AdminSiteFilter = {
        actionRequiresWritableSite,
        getSiteFilter,
        applySiteFilter,
        getSiteParam,
        getWritableSite,
        isAllSitesSelected,
        formRequiresWritableSite,
        requireWritableSite,
        renderSiteSelector,
        toggleDropdown,
        select
    };
})();
