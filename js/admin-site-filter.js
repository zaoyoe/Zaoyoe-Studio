/**
 * Admin Site Filter - 管理后台站点过滤器
 * 提供全局站点选择下拉框，所有管理模块共用
 */

(function () {
    'use strict';

    const VALID_SITE_FILTERS = new Set(['all', 'cn', 'intl']);

    // Current admin site filter: 'all' | 'cn' | 'intl'
    let currentFilter = normalizeSiteFilterValue(localStorage.getItem('admin_site_filter'));
    let siteSwitchInProgress = false;
    let siteSwitchTargetFilter = '';
    let siteSwitchRequestId = 0;
    let siteSwitchToast = null;

    const SITE_OPTIONS = Object.freeze({
        all: {
            label: '全部站点',
            shortLabel: 'ALL',
            menuLabel: '全部站点',
            hint: '聚合查看',
            icon: 'fas fa-globe'
        },
        cn: {
            label: 'CN',
            shortLabel: 'CN',
            menuLabel: 'CN 站',
            hint: '中文运营',
            icon: 'fas fa-location-dot'
        },
        intl: {
            label: 'EN',
            shortLabel: 'EN',
            menuLabel: 'EN 站',
            hint: '国际运营',
            icon: 'fas fa-earth-americas'
        }
    });
    const SITE_LABELS = Object.freeze(Object.fromEntries(
        Object.entries(SITE_OPTIONS).map(([key, option]) => [key, option.label])
    ));
    const SITE_OPTION_ORDER = Object.freeze(['all', 'cn', 'intl']);
    const WRITABLE_ACTION_LABELS = Object.freeze({
        'comments-batch-delete': '批量删除评论',
        'gallery-batch-add-homepage': '批量加入首页精选',
        'gallery-batch-backfill-prompt-text': '回填已发布 Prompt 提示词',
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

    function getSiteOption(value = currentFilter) {
        return SITE_OPTIONS[normalizeSiteFilterValue(value)] || SITE_OPTIONS.all;
    }

    function getSiteSwitchLabel(value = currentFilter) {
        const option = getSiteOption(value);
        return option.menuLabel || option.label || option.shortLabel || '当前站点';
    }

    function dismissSiteSwitchToast() {
        if (!siteSwitchToast) {
            return;
        }
        const toast = siteSwitchToast;
        siteSwitchToast = null;
        if (!toast.isConnected) {
            return;
        }
        toast.classList?.add?.('is-dismissing');
        const removeToast = () => toast.remove?.();
        if (typeof window.setTimeout === 'function') {
            window.setTimeout(removeToast, 180);
        } else {
            removeToast();
        }
    }

    function showSiteSwitchToast(message = '', type = 'info', options = {}) {
        dismissSiteSwitchToast();
        if (typeof window.showToast !== 'function') {
            return null;
        }
        siteSwitchToast = window.showToast(message, type, {
            durationMs: options.durationMs ?? 0,
            feedback: options.feedback
        });
        return siteSwitchToast;
    }

    function setSiteSwitchProgress(isBusy, target = currentFilter) {
        siteSwitchInProgress = isBusy === true;
        siteSwitchTargetFilter = siteSwitchInProgress ? normalizeSiteFilterValue(target) : '';
        renderSiteSelector();
    }

    function closeDropdown() {
        const menu = document.getElementById('siteSelectorMenu');
        if (menu) menu.classList.remove('show');
        const selector = document.getElementById('adminSiteSelector');
        selector?.classList.remove('is-open');
        selector?.querySelector('.site-selector-btn')?.setAttribute('aria-expanded', 'false');
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

        const currentOption = getSiteOption(currentFilter);
        const currentShortLabel = currentOption.shortLabel || currentOption.label;
        const busyLabel = siteSwitchInProgress ? `正在切换到${getSiteSwitchLabel(siteSwitchTargetFilter || currentFilter)}` : '切换站点视角';

        container.innerHTML = `
            <div class="admin-site-filter-toolbar">
                <div class="admin-site-selector ${siteSwitchInProgress ? 'is-site-switching' : ''}" id="adminSiteSelector">
                    <button
                        class="site-selector-btn ${siteSwitchInProgress ? 'is-loading' : ''}"
                        type="button"
                        data-admin-action="site-filter-toggle-dropdown"
                        aria-haspopup="listbox"
                        aria-expanded="false"
                        aria-busy="${siteSwitchInProgress ? 'true' : 'false'}"
                        aria-label="${busyLabel}"
                        title="${busyLabel}"
                        ${siteSwitchInProgress ? 'disabled' : ''}>
                        <span class="site-selector-btn__copy">
                            <span class="site-selector-label">${currentShortLabel}</span>
                        </span>
                        <span class="site-selector-spinner" aria-hidden="true">
                            <i class="fas fa-spinner fa-spin"></i>
                        </span>
                        <span class="site-selector-chevron" aria-hidden="true">
                            <i class="fas fa-chevron-down"></i>
                        </span>
                    </button>
                    <div class="site-selector-menu" id="siteSelectorMenu" role="listbox" aria-label="站点视角">
                        ${SITE_OPTION_ORDER.map((key) => {
                            const option = getSiteOption(key);
                            return `
                            <button type="button" class="site-selector-option ${key === currentFilter ? 'active' : ''}"
                                 data-admin-action="site-filter-select"
                                 data-site-filter-value="${key}"
                                 role="option"
                                 aria-selected="${key === currentFilter ? 'true' : 'false'}">
                                <span class="site-selector-option__mark site-selector-option__mark--${key}" aria-hidden="true">
                                    <i class="${option.icon}"></i>
                                </span>
                                <span class="site-selector-option__copy">
                                    <span class="site-selector-option__label">${option.menuLabel}</span>
                                    <span class="site-selector-option__hint">${option.hint}</span>
                                </span>
                                <span class="site-selector-option__check" aria-hidden="true">
                                    <i class="fas fa-check"></i>
                                </span>
                            </button>
                        `;
                        }).join('')}
                    </div>
                </div>
                <button
                    class="theme-toggle-btn admin-theme-toggle-btn"
                    type="button"
                    id="adminThemeToggleBtn"
                    data-admin-action="toggle-theme"
                    aria-label="切换亮暗主题"
                    title="切换亮暗主题">
                    <span class="theme-icon sun-icon" aria-hidden="true">☀️</span>
                    <span class="theme-icon moon-icon" aria-hidden="true">🌙</span>
                </button>
            </div>
        `;

        window.syncAdminStudioThemeToggle?.();
    }

    function toggleDropdown() {
        if (siteSwitchInProgress) {
            return;
        }
        const menu = document.getElementById('siteSelectorMenu');
        const selector = document.getElementById('adminSiteSelector');
        const trigger = selector?.querySelector('.site-selector-btn');
        if (!menu) return;

        const isOpen = menu.classList.toggle('show');
        selector?.classList.toggle('is-open', isOpen);
        trigger?.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }

    async function runActiveModuleSiteChange(changeDetail = {}) {
        if (typeof window.AdminShell?.handleSiteChangeAsync === 'function') {
            return window.AdminShell.handleSiteChangeAsync(changeDetail);
        }

        if (window.AdminShell?.handleSiteChange?.(changeDetail) !== true) {
            return reloadCurrentModule(changeDetail);
        }

        return true;
    }

    async function select(value) {
        const nextFilter = normalizeSiteFilterValue(value);
        if (nextFilter === currentFilter && !siteSwitchInProgress) {
            closeDropdown();
            return false;
        }

        const requestId = siteSwitchRequestId + 1;
        siteSwitchRequestId = requestId;
        currentFilter = nextFilter;
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

        setSiteSwitchProgress(true, currentFilter);
        showSiteSwitchToast(`正在切换到${getSiteSwitchLabel(currentFilter)}...`, 'info', { durationMs: 0 });

        const changeDetail = {
            site: currentFilter,
            writableSite: getWritableSite(),
            isAllSitesSelected: isAllSitesSelected()
        };

        // Dispatch custom event for modules that still subscribe directly.
        window.dispatchEvent(new CustomEvent('admin-site-changed', {
            detail: changeDetail
        }));

        try {
            await Promise.resolve(runActiveModuleSiteChange(changeDetail));
            if (requestId !== siteSwitchRequestId) {
                return false;
            }
            dismissSiteSwitchToast();
            setSiteSwitchProgress(false);
            window.showToast?.(`已切换到${getSiteSwitchLabel(currentFilter)}`, 'success', {
                durationMs: 1800
            });
            return true;
        } catch (error) {
            if (requestId !== siteSwitchRequestId) {
                return false;
            }
            console.warn('[AdminSiteFilter] Failed to refresh active module after site change:', error);
            dismissSiteSwitchToast();
            setSiteSwitchProgress(false);
            window.showToast?.(`已切换到${getSiteSwitchLabel(currentFilter)}，但当前模块刷新失败`, 'warning', {
                durationMs: 3200
            });
            return false;
        }
    }

    function reloadCurrentModule(detail = {}) {
        const activeModule = document.querySelector('.module-container.active');
        if (!activeModule) return;

        const moduleId = activeModule.id.replace('module-', '');

        if (moduleId === 'growth-center' && typeof window.handleAdminGrowthCenterSiteChange === 'function') {
            void Promise.resolve(window.handleAdminGrowthCenterSiteChange(detail)).catch((error) => {
                console.warn('Failed to refresh growth center after site change:', error);
            });
            return;
        }

        if (isAnalyticsModuleId(moduleId)) {
            if (typeof window.handleAdminAnalyticsSiteChange === 'function') {
                void Promise.resolve(window.handleAdminAnalyticsSiteChange({
                    ...detail,
                    activeModuleId: moduleId
                })).catch((error) => {
                    console.warn('Failed to refresh analytics after site change:', error);
                });
            } else if (typeof window.reloadAnalyticsDashboard === 'function') {
                window.reloadAnalyticsDashboard({ reason: 'site-change' });
            } else if (typeof window.initAnalyticsModule === 'function') {
                window.initAnalyticsModule();
            }
            return;
        }

        // Call appropriate reload function based on active module
        switch (moduleId) {
            case 'homepage':
                if (typeof window.handleAdminHomepageSiteChange === 'function') {
                    void Promise.resolve(window.handleAdminHomepageSiteChange(detail)).catch((error) => {
                        console.warn('Failed to refresh homepage after site change:', error);
                    });
                }
                break;
            case 'users':
                if (typeof window.handleAdminUsersSiteChange === 'function') {
                    void Promise.resolve(window.handleAdminUsersSiteChange()).catch((error) => {
                        console.warn('Failed to refresh users after site change:', error);
                    });
                } else if (typeof window.loadUsers === 'function') {
                    window.loadUsers();
                }
                break;
            case 'shop':
                if (typeof window.handleAdminShopSiteChange === 'function') {
                    void Promise.resolve(window.handleAdminShopSiteChange(detail)).catch((error) => {
                        console.warn('Failed to refresh shop after site change:', error);
                    });
                } else if (window.ShopAdmin) {
                    if (typeof window.ShopAdmin.handleSiteChange === 'function') {
                        window.ShopAdmin.handleSiteChange(detail);
                    } else {
                        if (typeof ShopAdmin.searchOrders === 'function') ShopAdmin.searchOrders();
                        if (typeof ShopAdmin.loadProducts === 'function') ShopAdmin.loadProducts();
                    }
                }
                break;
            case 'points':
                if (typeof window.handleAdminPointsSiteChange === 'function') {
                    void Promise.resolve(window.handleAdminPointsSiteChange(detail)).catch((error) => {
                        console.warn('Failed to refresh points after site change:', error);
                    });
                } else {
                    if (typeof window.clearPendingPointsBatchOpen === 'function') {
                        window.clearPendingPointsBatchOpen();
                    }
                    if (typeof window.closeCodesModal === 'function' && String(window.currentViewBatchId || '').trim()) {
                        window.closeCodesModal();
                    }
                    if (typeof window.loadBatches === 'function') window.loadBatches();
                }
                break;
            case 'payments':
                if (typeof window.handleAdminPaymentsSiteChange === 'function') {
                    void Promise.resolve(window.handleAdminPaymentsSiteChange(detail)).catch((error) => {
                        console.warn('Failed to refresh payments after site change:', error);
                    });
                } else if (window.AdminPayments && typeof window.AdminPayments.reload === 'function') {
                    window.AdminPayments.reload();
                }
                break;
            case 'comments':
                if (typeof window.handleAdminCommentsSiteChange === 'function') {
                    void Promise.resolve(window.handleAdminCommentsSiteChange()).catch((error) => {
                        console.warn('Failed to refresh comments after site change:', error);
                    });
                } else {
                    if (typeof window.loadComments === 'function') {
                        const view = window.currentCommentView || 'guestbook';
                        window.loadComments(view);
                    }
                    if (typeof window.loadCommentStats === 'function') window.loadCommentStats();
                }
                break;
            case 'gallery':
                if (typeof window.handleAdminGallerySiteChange === 'function') {
                    window.handleAdminGallerySiteChange();
                } else if (typeof window.loadAdminPrompts === 'function') {
                    window.loadAdminPrompts();
                }
                break;
            case 'settings':
                if (typeof window.handleAdminSettingsSiteChange === 'function') {
                    void Promise.resolve(window.handleAdminSettingsSiteChange(detail)).catch((error) => {
                        console.warn('Failed to refresh settings after site change:', error);
                    });
                }
                break;
            case 'discounts':
                if (typeof window.handleAdminDiscountsSiteChange === 'function') {
                    void Promise.resolve(window.handleAdminDiscountsSiteChange(detail)).catch((error) => {
                        console.warn('Failed to refresh discounts after site change:', error);
                    });
                }
                break;
            case 'ops-alerts':
                if (typeof window.handleAdminOpsAlertsSiteChange === 'function') {
                    void Promise.resolve(window.handleAdminOpsAlertsSiteChange(detail)).catch((error) => {
                        console.warn('Failed to refresh ops alerts after site change:', error);
                    });
                }
                break;
            case 'chat':
                if (typeof window.handleAdminChatModuleSiteChange === 'function') {
                    void Promise.resolve(window.handleAdminChatModuleSiteChange()).catch((error) => {
                        console.warn('Failed to refresh chat after site change:', error);
                    });
                } else {
                    const chatInstance = typeof window.ensureAdminChatInstance === 'function'
                        ? window.ensureAdminChatInstance({ ensureLayout: true })
                        : window.adminChatInstance;
                    if (chatInstance?.fetchSessions) {
                        void Promise.resolve(chatInstance.fetchSessions()).catch((error) => {
                            console.warn('Failed to refresh chat sessions after site change:', error);
                        });
                    }
                }
                break;
        }
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#adminSiteSelector')) {
            closeDropdown();
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
