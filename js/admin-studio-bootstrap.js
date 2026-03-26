(function () {
    'use strict';

    const { url: SUPABASE_URL, publishableKey: SUPABASE_KEY } = window.requireZaoyoeSupabaseConfig();
    window.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    function toggleMobileSidebar() {
        const sidebar = document.querySelector('.admin-sidebar');
        const overlay = document.getElementById('sidebarOverlay');
        sidebar?.classList.toggle('open');
        overlay?.classList.toggle('active');
    }

    function closeMobileSidebar() {
        const sidebar = document.querySelector('.admin-sidebar');
        const overlay = document.getElementById('sidebarOverlay');
        sidebar?.classList.remove('open');
        overlay?.classList.remove('active');
    }

    function baseSwitchModule(moduleId) {
        const clickedItem = document.querySelector(`[data-module="${moduleId}"]`);
        if (clickedItem && clickedItem.classList.contains('disabled')) {
            return false;
        }

        document.querySelectorAll('.sidebar-item').forEach((item) => {
            item.classList.remove('active');
        });
        if (clickedItem) {
            clickedItem.classList.add('active');
        }

        document.querySelectorAll('.module-container').forEach((element) => {
            element.hidden = true;
            element.classList.remove('active');
        });

        const target = document.getElementById(`module-${moduleId}`);
        if (target) {
            target.hidden = false;
            target.classList.add('active');

            if (moduleId === 'users') window.initUserModule?.();
            if (moduleId === 'analytics') window.initAnalyticsModule?.();
            if (moduleId === 'payments' && window.AdminPayments?.init) window.AdminPayments.init();
            if (moduleId === 'shop') window.ShopAdmin?.init?.();
            if (moduleId === 'discounts' && typeof window.AdminDiscounts !== 'undefined') window.AdminDiscounts.init();
            if (moduleId === 'comments') {
                window.initCommentsModule?.();
            } else if (moduleId === 'settings') {
                window.initSettingsModule?.();
            } else if (moduleId === 'points') {
                window.loadBatches?.();
                window.loadPackagesForSelect?.();
            }
        }

        closeMobileSidebar();
        return true;
    }

    function getAdminStudioUrlObject() {
        try {
            return new URL(window.location.href);
        } catch (error) {
            console.warn('[AdminStudio] Failed to parse current URL:', error);
            return null;
        }
    }

    function syncAdminStudioModuleUrl(moduleName) {
        const url = getAdminStudioUrlObject();
        if (!url || typeof window.history?.replaceState !== 'function') {
            return;
        }

        const normalizedModule = String(moduleName || '').trim().toLowerCase() || 'gallery';
        if (normalizedModule === 'gallery') {
            url.searchParams.delete('module');
        } else {
            url.searchParams.set('module', normalizedModule);
        }

        const nextRelativeUrl = `${url.pathname}${url.search}${url.hash}`;
        const currentRelativeUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        if (nextRelativeUrl !== currentRelativeUrl) {
            window.history.replaceState(window.history.state, '', nextRelativeUrl);
        }
    }

    function restoreAdminStudioModuleFromUrl() {
        const url = getAdminStudioUrlObject();
        if (!url) {
            return 'gallery';
        }

        const requestedModule = String(url.searchParams.get('module') || '').trim().toLowerCase();
        if (!requestedModule) {
            return 'gallery';
        }

        return document.getElementById(`module-${requestedModule}`) ? requestedModule : 'gallery';
    }

    function bindAdminStudioStaticFallbackControls() {
        if (document.documentElement.dataset.adminStudioFallbackControlsBound === '1') {
            return;
        }

        document.documentElement.dataset.adminStudioFallbackControlsBound = '1';

        const bindClick = (selector, handler) => {
            document.querySelectorAll(selector).forEach((element) => {
                element.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    handler(element, event);
                });
            });
        };

        bindClick('[data-admin-action="discounts-open-generate-modal"]', () => {
            window.AdminDiscounts?.openGenerateModal?.();
        });

        bindClick('[data-admin-action="discounts-close-generate-modal"]', () => {
            window.AdminDiscounts?.closeGenerateModal?.();
        });

        bindClick('[data-admin-action="discounts-submit-generate"]', async () => {
            await window.AdminDiscounts?.submitGenerate?.();
        });

        bindClick('[data-admin-action="tickets-close-reply-modal"]', () => {
            window.AdminTickets?.closeReplyModal?.();
        });

        bindClick('[data-admin-action="tickets-submit-reply"]', async () => {
            await window.AdminTickets?.submitReply?.();
        });

        bindClick('[data-admin-action="analytics-open-experiment-modal"]', () => {
            window.openExperimentModal?.();
        });

        bindClick('[data-admin-action="analytics-close-experiment-modal"]', () => {
            window.closeExperimentModal?.();
        });

        bindClick('[data-admin-action="settings-open-ops-alert-workspace"]', (element) => {
            window.openOpsAlertWorkspace?.(element.dataset.workspaceTarget, {
                alertType: element.dataset.workspaceAlertType,
                category: element.dataset.workspaceCategory,
                referenceLabel: element.dataset.workspaceReferenceLabel,
                referenceValue: element.dataset.workspaceReferenceValue,
                targetId: element.dataset.workspaceTargetId
            });
        });

        const bindSubmit = (formId, handler) => {
            const form = document.getElementById(formId);
            if (!form) {
                return;
            }

            form.addEventListener('submit', async (event) => {
                event.preventDefault();
                event.stopPropagation();
                await handler(event);
            });
        };

        bindSubmit('discountGenerateForm', async () => {
            await window.AdminDiscounts?.submitGenerate?.();
        });

        bindSubmit('ticketReplyForm', async () => {
            await window.AdminTickets?.submitReply?.();
        });

        bindSubmit('experimentForm', async (event) => {
            await window.handleCreateExperiment?.(event);
        });

        const discountOverlay = document.getElementById('discountGenerateModal');
        if (discountOverlay) {
            discountOverlay.addEventListener('click', (event) => {
                if (event.target === discountOverlay) {
                    event.preventDefault();
                    event.stopPropagation();
                    window.AdminDiscounts?.closeGenerateModal?.();
                }
            });
        }
    }

    function switchModule(moduleName) {
        const switched = baseSwitchModule(moduleName);
        if (!switched) {
            return;
        }

        if (moduleName === 'chat' && !window.adminChatInstance && typeof window.AdminChat === 'function') {
            window.adminChatInstance = new window.AdminChat();
        }

        if (moduleName === 'homepage' && typeof window.HomepageAdmin?.init === 'function') {
            window.HomepageAdmin.init();
        }

        if (moduleName === 'tickets' && typeof window.AdminTickets?.init === 'function') {
            window.AdminTickets.init();
        }

        syncAdminStudioModuleUrl(moduleName);
    }

    window.toggleMobileSidebar = toggleMobileSidebar;
    window.closeMobileSidebar = closeMobileSidebar;
    window.getAdminStudioUrlObject = getAdminStudioUrlObject;
    window.syncAdminStudioModuleUrl = syncAdminStudioModuleUrl;
    window.restoreAdminStudioModuleFromUrl = restoreAdminStudioModuleFromUrl;
    window.switchModule = switchModule;
    bindAdminStudioStaticFallbackControls();

    document.addEventListener('click', (event) => {
        const dropdown = document.getElementById('discountTypeDropdown');
        const wrapper = document.getElementById('discountTypeWrapper');
        if (dropdown && wrapper && !wrapper.contains(event.target)) {
            if (window.AdminDiscounts?.setTypeDropdownOpen) {
                window.AdminDiscounts.setTypeDropdownOpen(false);
            } else {
                dropdown.classList.remove('is-open');
                dropdown.setAttribute('aria-hidden', 'true');
            }
        }
    });

    window.addEventListener('load', () => {
        const initialModule = restoreAdminStudioModuleFromUrl();
        if (initialModule !== 'gallery') {
            switchModule(initialModule);
        }

        console.log('Window loaded, checking shop module...');
        if (typeof window.ShopAdmin?.init === 'function') {
            console.log('Auto-initializing ShopAdmin on page load...');
            window.ShopAdmin.init();
        } else {
            console.warn('ShopAdmin not found on window load');
        }
    });
}());
