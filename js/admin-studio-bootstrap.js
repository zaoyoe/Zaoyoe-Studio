(function () {
    'use strict';

    const { url: SUPABASE_URL, publishableKey: SUPABASE_KEY } = window.requireZaoyoeSupabaseConfig();
    window.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    const ADMIN_PERMISSION_GROUPS = [
        {
            id: 'content',
            title: '内容与社区',
            description: '控制内容审核、Prompt 运营与社区治理。',
            permissions: [
                {
                    key: 'content.moderate',
                    label: '内容审核',
                    icon: '📝',
                    description: '审核 Gallery 内容与评论处置',
                    modules: ['gallery', 'comments']
                },
                {
                    key: 'prompts.manage',
                    label: 'Prompt 管理',
                    icon: '🎨',
                    description: '维护 Prompt 运营与 Gallery 管理页',
                    modules: ['gallery']
                },
                {
                    key: 'chat.manage',
                    label: '客服消息',
                    icon: '💬',
                    description: '处理客服消息与对话后台',
                    modules: ['chat']
                }
            ]
        },
        {
            id: 'commerce',
            title: '商城与交易',
            description: '控制商城、券码、支付与积分能力。',
            permissions: [
                {
                    key: 'shop.manage',
                    label: '商城系统',
                    icon: '🛍️',
                    description: '商品、库存、订单与商城运营',
                    modules: ['shop']
                },
                {
                    key: 'discounts.manage',
                    label: '优惠券码',
                    icon: '🎟️',
                    description: '券码生成、发放与营销活动',
                    modules: ['discounts']
                },
                {
                    key: 'payments.manage',
                    label: '支付对账',
                    icon: '💳',
                    description: '支付订单、异常核对与回调排查',
                    modules: ['payments']
                },
                {
                    key: 'points.manage',
                    label: '积分管理',
                    icon: '🪙',
                    description: '积分批次、兑换码与余额运营',
                    modules: ['points']
                }
            ]
        },
        {
            id: 'users',
            title: '用户与增长',
            description: '控制用户资料、售后协作与站点增长配置。',
            permissions: [
                {
                    key: 'users.manage',
                    label: '用户管理',
                    icon: '👥',
                    description: '用户详情、封禁、备注与关系排查',
                    modules: ['users']
                },
                {
                    key: 'tickets.manage',
                    label: '售后工单',
                    icon: '🎧',
                    description: '售后工单处理与客服回访',
                    modules: ['tickets']
                },
                {
                    key: 'homepage.manage',
                    label: '主页内容',
                    icon: '🏠',
                    description: '主页运营位、专题与内容编排',
                    modules: ['homepage']
                }
            ]
        },
        {
            id: 'operations',
            title: '运维与策略',
            description: '控制监控规则、系统设置与运营分析。',
            permissions: [
                {
                    key: 'ops_alerts.manage',
                    label: '站外告警',
                    icon: '🔔',
                    description: '监控规则、工作区与站外通知策略',
                    modules: ['ops-alerts']
                },
                {
                    key: 'settings.manage',
                    label: '设置',
                    icon: '⚙️',
                    description: '系统配置、安全策略与运维开关',
                    modules: ['settings']
                },
                {
                    key: 'analytics.view',
                    label: '数据分析',
                    icon: '📊',
                    description: '查看后台数据面板与趋势统计',
                    modules: ['analytics']
                }
            ]
        }
    ];
    const ADMIN_MODULE_PERMISSION_MATRIX = {
        gallery: {
            label: 'Gallery',
            anyOf: ['prompts.manage', 'content.moderate']
        },
        comments: {
            label: '评论管理',
            anyOf: ['content.moderate']
        },
        chat: {
            label: '客服消息',
            anyOf: ['chat.manage']
        },
        shop: {
            label: '商城系统',
            anyOf: ['shop.manage']
        },
        discounts: {
            label: '优惠券码',
            anyOf: ['discounts.manage']
        },
        homepage: {
            label: '主页内容',
            anyOf: ['homepage.manage']
        },
        users: {
            label: '用户管理',
            anyOf: ['users.manage']
        },
        points: {
            label: '积分管理',
            anyOf: ['points.manage']
        },
        tickets: {
            label: '售后工单',
            anyOf: ['tickets.manage']
        },
        analytics: {
            label: '数据分析',
            anyOf: ['analytics.view']
        },
        payments: {
            label: '支付对账',
            anyOf: ['payments.manage']
        },
        'ops-alerts': {
            label: '站外告警',
            anyOf: ['ops_alerts.manage']
        },
        settings: {
            label: '设置',
            anyOf: ['settings.manage']
        }
    };
    const ADMIN_PERMISSION_INDEX = new Map(
        ADMIN_PERMISSION_GROUPS.flatMap((group) =>
            (Array.isArray(group.permissions) ? group.permissions : []).map((permission) => [
                permission.key,
                {
                    ...permission,
                    groupId: group.id,
                    groupTitle: group.title,
                    groupDescription: group.description || ''
                }
            ])
        )
    );

    window.ADMIN_PERMISSION_GROUPS = ADMIN_PERMISSION_GROUPS;
    window.ADMIN_MODULE_PERMISSION_MATRIX = ADMIN_MODULE_PERMISSION_MATRIX;

    function normalizeAdminModuleId(moduleId) {
        return String(moduleId || '').trim().toLowerCase();
    }

    function getAdminPermissionDefinition(permissionKey) {
        return ADMIN_PERMISSION_INDEX.get(String(permissionKey || '').trim()) || null;
    }

    function getAdminPermissionLabel(permissionKey) {
        return getAdminPermissionDefinition(permissionKey)?.label || String(permissionKey || '').trim();
    }

    function getAdminModuleDefinition(moduleId) {
        const normalizedModuleId = normalizeAdminModuleId(moduleId);
        return ADMIN_MODULE_PERMISSION_MATRIX[normalizedModuleId] || null;
    }

    function getModulePermissionRequirementText(moduleId) {
        const definition = getAdminModuleDefinition(moduleId);
        const requirements = Array.isArray(definition?.anyOf) ? definition.anyOf : [];
        return requirements
            .map((permissionKey) => getAdminPermissionLabel(permissionKey))
            .filter(Boolean)
            .join(' / ');
    }

    function hasModulePermission(moduleId, options = {}) {
        const definition = getAdminModuleDefinition(moduleId);
        if (!definition) {
            return true;
        }

        const isSuperAdmin = options.isSuperAdmin === true || window.isSuperAdmin === true;
        if (isSuperAdmin) {
            return true;
        }

        const permissions = Array.isArray(options.permissions)
            ? options.permissions
            : (Array.isArray(window.currentUserPermissions) ? window.currentUserPermissions : []);
        if (permissions.includes('*')) {
            return true;
        }

        const anyOf = Array.isArray(definition.anyOf) ? definition.anyOf : [];
        if (!anyOf.length) {
            return true;
        }

        return anyOf.some((permissionKey) => permissions.includes(permissionKey));
    }

    function getFirstAccessibleAdminModule(preferredModule = '') {
        const normalizedPreferredModule = normalizeAdminModuleId(preferredModule);
        if (normalizedPreferredModule && hasModulePermission(normalizedPreferredModule)) {
            return normalizedPreferredModule;
        }

        const sidebarItems = document.querySelectorAll('.sidebar-item[data-module]');
        for (const item of sidebarItems) {
            const moduleId = normalizeAdminModuleId(item.dataset.module);
            if (moduleId && hasModulePermission(moduleId)) {
                return moduleId;
            }
        }

        return '';
    }

    function ensureAdminModuleAccessBadge(item) {
        let badge = item.querySelector('.admin-module-lock-badge');
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'coming-soon admin-module-lock-badge';
            badge.textContent = '未授权';
            item.appendChild(badge);
        }
        return badge;
    }

    function ensureAdminModuleAccessNotice() {
        let notice = document.getElementById('adminModuleAccessNotice');
        if (notice) {
            return notice;
        }

        const mainContent = document.querySelector('.admin-main-content');
        if (!mainContent) {
            return null;
        }

        notice = document.createElement('section');
        notice.id = 'adminModuleAccessNotice';
        notice.className = 'admin-module-access-notice admin-studio-inline-style-attr-3';
        notice.hidden = true;
        notice.innerHTML = `
            <div class="admin-module-access-notice__card">
                <div class="admin-module-access-notice__icon"><i class="fas fa-user-lock"></i></div>
                <div class="admin-module-access-notice__copy">
                    <h3>当前账号还没有分配具体模块权限</h3>
                    <p>管理员身份已生效，但还没有勾选任何后台模块权限。请在“用户管理 > 权限”里补充模块授权后再进入对应页面。</p>
                </div>
            </div>
        `;
        mainContent.prepend(notice);
        return notice;
    }

    function setAdminModuleNoticeVisible(visible) {
        const notice = ensureAdminModuleAccessNotice();
        if (!notice) {
            return;
        }

        notice.classList.toggle('admin-studio-inline-style-attr-3', !visible);
        notice.toggleAttribute('hidden', !visible);
        notice.classList.toggle('is-visible', visible);
    }

    function applySidebarModuleAccess(item, accessible) {
        const moduleId = normalizeAdminModuleId(item.dataset.module);
        const moduleDefinition = getAdminModuleDefinition(moduleId);
        const badge = ensureAdminModuleAccessBadge(item);
        const requirementText = getModulePermissionRequirementText(moduleId);

        item.classList.toggle('disabled', !accessible);
        item.setAttribute('aria-disabled', accessible ? 'false' : 'true');

        if (accessible) {
            badge.hidden = true;
            if (moduleDefinition?.label) {
                item.title = moduleDefinition.label;
            } else {
                item.removeAttribute('title');
            }
            return;
        }

        badge.hidden = false;
        item.title = requirementText
            ? `需要权限：${requirementText}`
            : '当前账号未授权访问该模块';
    }

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
            if (moduleId === 'ops-alerts') window.initOpsAlertsModule?.();
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

    function activateAdminStudioModule(moduleName) {
        const normalizedModuleName = normalizeAdminModuleId(moduleName) || 'gallery';
        const switched = baseSwitchModule(normalizedModuleName);
        if (!switched) {
            return false;
        }

        if (normalizedModuleName === 'chat' && !window.adminChatInstance && typeof window.AdminChat === 'function') {
            window.adminChatInstance = new window.AdminChat();
        }

        if (normalizedModuleName === 'homepage' && typeof window.HomepageAdmin?.init === 'function') {
            window.HomepageAdmin.init();
        }

        if (normalizedModuleName === 'tickets' && typeof window.AdminTickets?.init === 'function') {
            window.AdminTickets.init();
        }

        syncAdminStudioModuleUrl(normalizedModuleName);
        setAdminModuleNoticeVisible(false);
        return true;
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

    function syncAdminStudioModuleAccess(options = {}) {
        const accessResolved = window.adminStudioAccessGranted === true || window.isAdmin === true || window.isSuperAdmin === true;
        if (!accessResolved && options.deferUntilAccess !== false) {
            return [];
        }

        const sidebarItems = document.querySelectorAll('.sidebar-item[data-module]');
        const accessibleModules = [];
        const preferredModule = normalizeAdminModuleId(options.preferredModule || restoreAdminStudioModuleFromUrl());

        sidebarItems.forEach((item) => {
            const moduleId = normalizeAdminModuleId(item.dataset.module);
            const accessible = hasModulePermission(moduleId);
            applySidebarModuleAccess(item, accessible);
            if (accessible) {
                accessibleModules.push(moduleId);
            }
        });

        if (!accessibleModules.length) {
            document.querySelectorAll('.sidebar-item.active').forEach((item) => {
                item.classList.remove('active');
            });
            document.querySelectorAll('.module-container').forEach((module) => {
                module.hidden = true;
                module.classList.remove('active');
            });
            setAdminModuleNoticeVisible(true);
            return [];
        }

        setAdminModuleNoticeVisible(false);

        if (options.enforceActiveModule !== false) {
            const activeModule = normalizeAdminModuleId(
                document.querySelector('.module-container.active')?.id?.replace(/^module-/, '')
                || document.querySelector('.sidebar-item.active[data-module]')?.dataset?.module
            );

            if (!activeModule || !hasModulePermission(activeModule)) {
                const fallbackModule = getFirstAccessibleAdminModule(preferredModule);
                if (fallbackModule) {
                    activateAdminStudioModule(fallbackModule);
                }
            }
        }

        return accessibleModules;
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

        bindSubmit('shopRiskCaseComposerForm', async () => {
            await window.submitOpsAlertCaseComposer?.();
        });

        bindSubmit('opsAlertBatchMuteForm', async () => {
            await window.submitOpsAlertBatchMuteModal?.();
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

    function switchModule(moduleName, options = {}) {
        const normalizedModuleName = normalizeAdminModuleId(moduleName) || 'gallery';
        if (!hasModulePermission(normalizedModuleName)) {
            if (options.silentDenied !== true) {
                const moduleLabel = getAdminModuleDefinition(normalizedModuleName)?.label || normalizedModuleName;
                const requirementText = getModulePermissionRequirementText(normalizedModuleName);
                window.showToast?.(
                    requirementText
                        ? `当前账号未分配「${moduleLabel}」模块权限，需要 ${requirementText}`
                        : `当前账号未分配「${moduleLabel}」模块权限`,
                    'warning'
                );
            }

            if (options.fallback !== false) {
                const fallbackModule = getFirstAccessibleAdminModule(options.preferredModule);
                if (fallbackModule && fallbackModule !== normalizedModuleName) {
                    return activateAdminStudioModule(fallbackModule);
                }
            }
            return;
        }

        activateAdminStudioModule(normalizedModuleName);
    }

    window.toggleMobileSidebar = toggleMobileSidebar;
    window.closeMobileSidebar = closeMobileSidebar;
    window.getAdminStudioUrlObject = getAdminStudioUrlObject;
    window.syncAdminStudioModuleUrl = syncAdminStudioModuleUrl;
    window.restoreAdminStudioModuleFromUrl = restoreAdminStudioModuleFromUrl;
    window.getAdminPermissionDefinition = getAdminPermissionDefinition;
    window.getAdminPermissionLabel = getAdminPermissionLabel;
    window.getAdminModuleDefinition = getAdminModuleDefinition;
    window.hasModulePermission = hasModulePermission;
    window.getFirstAccessibleAdminModule = getFirstAccessibleAdminModule;
    window.syncAdminStudioModuleAccess = syncAdminStudioModuleAccess;
    window.switchModule = switchModule;
    bindAdminStudioStaticFallbackControls();

    window.addEventListener('permissionsLoaded', () => {
        syncAdminStudioModuleAccess({
            preferredModule: restoreAdminStudioModuleFromUrl(),
            enforceActiveModule: true
        });
    });

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
        syncAdminStudioModuleAccess({
            preferredModule: initialModule,
            enforceActiveModule: true
        });

        console.log('Window loaded, checking shop module...');
        if (typeof window.ShopAdmin?.init === 'function') {
            if (hasModulePermission('shop')) {
                console.log('Auto-initializing ShopAdmin on page load...');
                window.ShopAdmin.init();
            } else {
                console.info('Skipping ShopAdmin auto-init because current admin lacks shop module access.');
            }
        } else {
            console.warn('ShopAdmin not found on window load');
        }
    });
}());
