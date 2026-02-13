/**
 * Admin Site Filter - 管理后台站点过滤器
 * 提供全局站点选择下拉框，所有管理模块共用
 */

(function () {
    'use strict';

    // Current admin site filter: 'all' | 'cn' | 'intl'
    let currentFilter = localStorage.getItem('admin_site_filter') || 'all';

    const SITE_LABELS = {
        all: '🌐 全部站点',
        cn: '🇨🇳 国内站 (zaoyoe.com)',
        intl: '🌍 国际站 (zaoyoe.xyz)'
    };

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

    /**
     * Render the site filter dropdown into target element
     */
    function renderSiteSelector() {
        const container = document.getElementById('adminSiteFilter');
        if (!container) return;

        container.innerHTML = `
            <div class="admin-site-selector" id="adminSiteSelector">
                <button class="site-selector-btn" onclick="AdminSiteFilter.toggleDropdown()">
                    <span class="site-selector-label">${SITE_LABELS[currentFilter]}</span>
                    <i class="fas fa-chevron-down"></i>
                </button>
                <div class="site-selector-menu" id="siteSelectorMenu">
                    ${Object.entries(SITE_LABELS).map(([key, label]) => `
                        <div class="site-selector-option ${key === currentFilter ? 'active' : ''}" 
                             onclick="AdminSiteFilter.select('${key}')">
                            ${label}
                        </div>
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
        currentFilter = value;
        localStorage.setItem('admin_site_filter', value);

        // Close dropdown
        const menu = document.getElementById('siteSelectorMenu');
        if (menu) menu.classList.remove('show');

        // Update button label
        const label = document.querySelector('.site-selector-label');
        if (label) label.textContent = SITE_LABELS[value];

        // Update active state
        document.querySelectorAll('.site-selector-option').forEach(opt => {
            opt.classList.toggle('active', opt.textContent.trim() === SITE_LABELS[value].trim());
        });

        // Dispatch custom event for modules to react
        window.dispatchEvent(new CustomEvent('admin-site-changed', { detail: { site: value } }));

        // Reload current module data
        reloadCurrentModule();
    }

    function reloadCurrentModule() {
        const activeModule = document.querySelector('.module-container.active');
        if (!activeModule) return;

        const moduleId = activeModule.id.replace('module-', '');

        // Call appropriate reload function based on active module
        switch (moduleId) {
            case 'users':
                if (typeof window.loadUsers === 'function') window.loadUsers();
                break;
            case 'shop':
                if (window.ShopAdmin) {
                    if (typeof ShopAdmin.searchOrders === 'function') ShopAdmin.searchOrders();
                    if (typeof ShopAdmin.loadProducts === 'function') ShopAdmin.loadProducts();
                }
                break;
            case 'points':
                if (typeof window.loadBatches === 'function') window.loadBatches();
                break;
            case 'analytics':
                if (typeof window.initAnalyticsModule === 'function') window.initAnalyticsModule();
                break;
            case 'comments':
                if (typeof window.loadComments === 'function') {
                    const view = window.currentCommentView || 'guestbook';
                    window.loadComments(view);
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
        getSiteFilter,
        applySiteFilter,
        getSiteParam,
        renderSiteSelector,
        toggleDropdown,
        select
    };
})();
