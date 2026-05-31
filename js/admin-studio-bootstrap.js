(function () {
    'use strict';

    const { url: SUPABASE_URL, publishableKey: SUPABASE_KEY } = window.requireZaoyoeSupabaseConfig();
    const ADMIN_OVERLAY_DISMISS_GUARD_SELECTOR = [
        '[data-admin-overlay-close]',
        '[data-shop-overlay-close]',
        '[data-points-overlay-close]'
    ].join(', ');

    function getAdminOverlayDismissGuardOverlay(event) {
        const target = event?.target instanceof Element ? event.target : event?.target?.parentElement;
        if (!target) {
            return null;
        }

        const overlay = target.closest?.(ADMIN_OVERLAY_DISMISS_GUARD_SELECTOR);
        return overlay instanceof HTMLElement ? overlay : null;
    }

    function resetAdminOverlayDismissPointerState(overlay) {
        if (!(overlay instanceof HTMLElement)) {
            return;
        }

        overlay.dataset.overlayDismissPointerDownBackdrop = '0';
        overlay.dataset.overlayDismissPointerUpBackdrop = '0';
    }

    function recordAdminOverlayDismissPointer(overlay, event, phase) {
        if (!(overlay instanceof HTMLElement)) {
            return;
        }

        const isPrimaryPointer = typeof event?.button !== 'number' || event.button === 0;
        const isBackdropPointer = isPrimaryPointer && event?.target === overlay;

        if (phase === 'down') {
            overlay.dataset.overlayDismissPointerDownBackdrop = isBackdropPointer ? '1' : '0';
            overlay.dataset.overlayDismissPointerUpBackdrop = '0';
            return;
        }

        if (phase === 'up') {
            overlay.dataset.overlayDismissPointerUpBackdrop = isBackdropPointer ? '1' : '0';
        }
    }

    const adminOverlayDismissGuard = {
        bind(overlay) {
            if (!(overlay instanceof HTMLElement) || overlay.dataset.overlayDismissPointerGuardBound === '1') {
                return overlay instanceof HTMLElement ? overlay : null;
            }

            overlay.dataset.overlayDismissPointerGuardBound = '1';
            resetAdminOverlayDismissPointerState(overlay);
            overlay.addEventListener('pointerdown', (event) => {
                recordAdminOverlayDismissPointer(overlay, event, 'down');
            });
            overlay.addEventListener('pointerup', (event) => {
                recordAdminOverlayDismissPointer(overlay, event, 'up');
            });
            overlay.addEventListener('pointercancel', () => {
                resetAdminOverlayDismissPointerState(overlay);
            });
            return overlay;
        },
        shouldDismiss(overlay, event) {
            if (!(overlay instanceof HTMLElement) || event?.target !== overlay) {
                return false;
            }

            if (overlay.dataset.overlayDismissPointerGuardBound !== '1') {
                return true;
            }

            const startedOnBackdrop = overlay.dataset.overlayDismissPointerDownBackdrop === '1';
            const endedOnBackdrop = overlay.dataset.overlayDismissPointerUpBackdrop === '1';
            resetAdminOverlayDismissPointerState(overlay);
            return startedOnBackdrop && endedOnBackdrop;
        }
    };

    if (document.documentElement.dataset.adminOverlayDismissGuardBound !== '1') {
        document.documentElement.dataset.adminOverlayDismissGuardBound = '1';
        document.addEventListener('pointerdown', (event) => {
            const overlay = getAdminOverlayDismissGuardOverlay(event);
            if (!overlay) {
                return;
            }

            adminOverlayDismissGuard.bind(overlay);
            recordAdminOverlayDismissPointer(overlay, event, 'down');
        }, true);
        document.addEventListener('pointerup', (event) => {
            const overlay = getAdminOverlayDismissGuardOverlay(event);
            if (!overlay) {
                return;
            }

            adminOverlayDismissGuard.bind(overlay);
            recordAdminOverlayDismissPointer(overlay, event, 'up');
        }, true);
        document.addEventListener('pointercancel', (event) => {
            const overlay = getAdminOverlayDismissGuardOverlay(event);
            if (overlay) {
                resetAdminOverlayDismissPointerState(overlay);
            }
        }, true);
    }

    window.AdminOverlayDismissGuard = Object.freeze(adminOverlayDismissGuard);

    function hasValidAccessToken(value) {
        if (!value) return false;

        if (typeof value === 'string') {
            return value.split('.').length >= 3 && value.length > 40;
        }

        if (Array.isArray(value)) {
            return value.some(hasValidAccessToken);
        }

        if (typeof value === 'object') {
            return hasValidAccessToken(value.access_token)
                || hasValidAccessToken(value.currentSession)
                || hasValidAccessToken(value.session)
                || hasValidAccessToken(value.data);
        }

        return false;
    }

    const guardStorage = {
        _locked: true,

        getItem(key) {
            return window.localStorage.getItem(key);
        },

        setItem(key, value) {
            if (this._locked && key.startsWith('sb-') && key.endsWith('-auth-token')) {
                try {
                    const parsed = JSON.parse(value);
                    if (hasValidAccessToken(parsed)) {
                        window.localStorage.setItem(key, value);
                    }
                    return;
                } catch (_) {
                    return;
                }
            }

            window.localStorage.setItem(key, value);
        },

        removeItem(key) {
            if (this._locked && key.startsWith('sb-') && key.endsWith('-auth-token')) {
                return;
            }

            window.localStorage.removeItem(key);
        }
    };

    function decodeJwtPayload(token) {
        const raw = String(token || '').trim();
        if (!raw || raw.split('.').length < 2) {
            return null;
        }

        try {
            const encoded = raw.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
            const padded = encoded + '='.repeat((4 - (encoded.length % 4)) % 4);
            return JSON.parse(window.atob(padded));
        } catch (_) {
            return null;
        }
    }

    function readPersistedSupabaseSession() {
        try {
            if (!window.localStorage) {
                return null;
            }

            for (let index = 0; index < window.localStorage.length; index += 1) {
                const key = window.localStorage.key(index);
                if (!key || !key.startsWith('sb-') || !key.endsWith('-auth-token')) {
                    continue;
                }

                const raw = window.localStorage.getItem(key);
                if (!raw) {
                    continue;
                }

                const parsed = JSON.parse(raw);
                const session = parsed?.currentSession || parsed?.session || parsed;
                if (session?.access_token && session?.refresh_token) {
                    return {
                        storageKey: key,
                        session
                    };
                }
            }
        } catch (_) {
            return null;
        }

        return null;
    }

    async function resolveWithTimeout(factory, timeoutMs = 6000, fallback = null) {
        try {
            return await Promise.race([
                Promise.resolve().then(factory),
                new Promise((resolve) => {
                    window.setTimeout(() => resolve(fallback), timeoutMs);
                })
            ]);
        } catch (_) {
            return fallback;
        }
    }

    async function resolveRuntimeAccessToken(client = window.supabaseClient) {
        const authClient = client?.auth || null;
        if (authClient?.getSession) {
            const currentSessionResult = await resolveWithTimeout(() => authClient.getSession(), 1500, null);
            const sdkAccessToken = String(currentSessionResult?.data?.session?.access_token || '').trim();
            if (sdkAccessToken) {
                return sdkAccessToken;
            }
        }

        return String(readPersistedSupabaseSession()?.session?.access_token || '').trim() || null;
    }

    async function writeAdminTextWithLegacyClipboard(text) {
        const normalizedText = String(text ?? '');
        const root = document.body || document.documentElement;
        if (!root || typeof document.execCommand !== 'function') {
            throw new Error('legacy_copy_unavailable');
        }

        const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const selection = typeof window.getSelection === 'function' ? window.getSelection() : null;
        const savedRanges = selection
            ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange())
            : [];
        const textarea = document.createElement('textarea');
        const restoreSelection = () => {
            if (!selection) return;
            selection.removeAllRanges();
            savedRanges.forEach((range) => selection.addRange(range));
        };

        textarea.value = normalizedText;
        textarea.setAttribute('readonly', '');
        textarea.setAttribute('aria-hidden', 'true');
        textarea.style.position = 'fixed';
        textarea.style.top = '0';
        textarea.style.left = '0';
        textarea.style.width = '1px';
        textarea.style.height = '1px';
        textarea.style.padding = '0';
        textarea.style.border = '0';
        textarea.style.opacity = '0';
        textarea.style.pointerEvents = 'none';
        textarea.style.fontSize = '16px';

        root.appendChild(textarea);
        try {
            textarea.focus({ preventScroll: true });
        } catch (_error) {
            textarea.focus();
        }
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);

        try {
            const copied = document.execCommand('copy');
            if (!copied) {
                throw new Error('legacy_copy_failed');
            }
        } finally {
            textarea.remove();
            restoreSelection();
            if (activeElement && typeof activeElement.focus === 'function') {
                try {
                    activeElement.focus({ preventScroll: true });
                } catch (_error) {
                    activeElement.focus();
                }
            }
        }
    }

    function installAdminClipboardFallback() {
        if (typeof navigator === 'undefined') return;

        const nativeClipboard = navigator.clipboard || null;
        const existingWriteText = nativeClipboard?.writeText || null;
        if (existingWriteText?.__adminClipboardFallback === true) {
            return;
        }

        const nativeWriteText = typeof existingWriteText === 'function'
            ? existingWriteText.bind(nativeClipboard)
            : null;
        const writeText = async (value) => {
            const normalizedText = String(value ?? '');
            const canUseNativeClipboard = typeof nativeWriteText === 'function'
                && (typeof window.isSecureContext !== 'boolean' || window.isSecureContext);

            if (canUseNativeClipboard) {
                try {
                    await nativeWriteText(normalizedText);
                    return;
                } catch (error) {
                    console.warn('[AdminClipboard] Clipboard API failed, trying legacy copy:', error?.message || error);
                }
            }

            await writeAdminTextWithLegacyClipboard(normalizedText);
        };
        Object.defineProperty(writeText, '__adminClipboardFallback', {
            value: true,
            configurable: false,
            enumerable: false
        });

        const clipboardTarget = nativeClipboard || {};
        try {
            Object.defineProperty(clipboardTarget, 'writeText', {
                value: writeText,
                configurable: true,
                enumerable: true
            });
        } catch (_error) {
            try {
                clipboardTarget.writeText = writeText;
            } catch (_) {
                // Leave window.AdminClipboard available even when the native object is sealed.
            }
        }

        if (!navigator.clipboard) {
            try {
                Object.defineProperty(navigator, 'clipboard', {
                    value: clipboardTarget,
                    configurable: true,
                    enumerable: true
                });
            } catch (_error) {
                try {
                    navigator.clipboard = clipboardTarget;
                } catch (_) {
                    // Some browsers expose navigator.clipboard as a non-configurable accessor.
                }
            }
        }

        window.AdminClipboard = Object.freeze({
            writeText,
            writeTextWithLegacyClipboard: writeAdminTextWithLegacyClipboard
        });
        window.copyAdminTextToClipboard = writeText;
    }

    installAdminClipboardFallback();

    window.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: {
            persistSession: true,
            autoRefreshToken: false,
            detectSessionInUrl: false,
            flowType: 'implicit',
            storage: guardStorage
        }
    });

    window.supabaseClient.accessToken = () => resolveRuntimeAccessToken(window.supabaseClient);
    resolveRuntimeAccessToken(window.supabaseClient)
        .then((accessToken) => {
            if (accessToken) {
                window.supabaseClient?.realtime?.setAuth?.(accessToken);
            }
        })
        .catch((error) => {
            console.warn('[AdminStudioBootstrap] Failed to seed realtime auth token:', error);
        });

    window.__adminStudioSessionRestoreReady = (async () => {
        const client = window.supabaseClient;
        if (!client?.auth?.getSession || !client?.auth?.setSession) {
            return {
                restored: false,
                reason: 'auth_unavailable'
            };
        }

        try {
            const currentSessionResult = await resolveWithTimeout(() => client.auth.getSession(), 4000, null);
            if (currentSessionResult?.data?.session?.access_token) {
                return {
                    restored: true,
                    source: 'sdk'
                };
            }
        } catch (_) {
            // Fall through to persisted-session recovery.
        }

        const persisted = readPersistedSupabaseSession()?.session || null;
        if (!persisted?.access_token || !persisted?.refresh_token) {
            return {
                restored: false,
                reason: 'missing_persisted_session'
            };
        }

        const payload = decodeJwtPayload(persisted.access_token) || {};
        const normalizedSession = {
            access_token: persisted.access_token,
            refresh_token: persisted.refresh_token,
            expires_at: Number(persisted.expires_at || payload.exp || 0) || undefined
        };

        const result = await resolveWithTimeout(() => client.auth.setSession(normalizedSession), 6000, null);
        if (!result) {
            return {
                restored: false,
                reason: 'set_session_timeout'
            };
        }

        if (result?.error) {
            return {
                restored: false,
                reason: 'set_session_failed',
                error: result.error
            };
        }

        return {
            restored: Boolean(result?.data?.session?.access_token),
            source: 'persisted'
        };
    })().catch((error) => {
        console.warn('[AdminStudioBootstrap] Failed to restore persisted Supabase session:', error);
        return {
            restored: false,
            reason: 'restore_exception',
            error
        };
    }).finally(() => {
        resolveRuntimeAccessToken(window.supabaseClient)
            .then((accessToken) => {
                if (accessToken) {
                    window.supabaseClient?.realtime?.setAuth?.(accessToken);
                }
            })
            .catch((error) => {
                console.warn('[AdminStudioBootstrap] Failed to refresh realtime auth token:', error);
            });
    });

    window.setTimeout(() => {
        guardStorage._locked = false;
    }, 3000);

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
                    description: '处理客服消息、机器人气泡触达与对话后台',
                    modules: ['chat', 'engagement']
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
                    label: '兑换码与套餐',
                    icon: '🪙',
                    description: '兑换码批次、套餐目录与兑换运营',
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
                    label: '站点布局',
                    icon: '🏠',
                    description: '站点入口、品牌跳转与首页内容编排',
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
                    modules: ['settings', 'xianyu-fulfillment']
                },
                {
                    key: 'analytics.view',
                    label: '经营分析中心',
                    icon: '📊',
                    description: '查看整站经营分析中心、趋势判断与经营闭环',
                    modules: ['analytics', 'business-overview', 'growth-center', 'commerce-center']
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
        engagement: {
            label: '客服系统',
            anyOf: ['chat.manage', 'settings.manage']
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
            label: '站点布局',
            anyOf: ['homepage.manage']
        },
        users: {
            label: '用户管理',
            anyOf: ['users.manage']
        },
        points: {
            label: '兑换码/套餐',
            anyOf: ['points.manage']
        },
        tickets: {
            label: '售后工单',
            anyOf: ['tickets.manage']
        },
        analytics: {
            label: '经营分析中心',
            anyOf: ['analytics.view']
        },
        'business-overview': {
            label: '经营总览',
            anyOf: ['analytics.view']
        },
        'growth-center': {
            label: '增长经营',
            anyOf: ['analytics.view']
        },
        'commerce-center': {
            label: '商品经营',
            anyOf: ['analytics.view']
        },
        payments: {
            label: '支付对账',
            anyOf: ['payments.manage']
        },
        'xianyu-fulfillment': {
            label: '闲鱼发货',
            anyOf: ['settings.manage']
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

    const ADMIN_ANALYTICS_MODULE_ALIASES = {
        analytics: {
            canonicalModuleId: 'analytics',
            sidebarModuleId: 'growth-center',
            routeModuleId: 'growth-center',
            defaultTab: 'overview'
        },
        'business-center': {
            canonicalModuleId: 'analytics',
            sidebarModuleId: 'growth-center',
            routeModuleId: 'growth-center',
            defaultTab: 'overview'
        },
        'analytics-center': {
            canonicalModuleId: 'analytics',
            sidebarModuleId: 'growth-center',
            routeModuleId: 'growth-center',
            defaultTab: 'overview'
        },
        'business-overview': {
            canonicalModuleId: 'analytics',
            sidebarModuleId: 'growth-center',
            routeModuleId: 'growth-center',
            defaultTab: 'overview'
        },
        'growth-center': {
            canonicalModuleId: 'analytics',
            sidebarModuleId: 'growth-center',
            routeModuleId: 'growth-center',
            defaultTab: 'overview'
        },
        'commerce-center': {
            canonicalModuleId: 'analytics',
            sidebarModuleId: 'commerce-center',
            routeModuleId: 'commerce-center',
            defaultTab: 'product'
        }
    };

    function normalizeAdminModuleValue(moduleId) {
        return String(moduleId || '').trim().toLowerCase();
    }

    function getAdminAnalyticsSidebarModuleIdForTab(tabId = '', options = {}) {
        const normalizedTabId = normalizeAdminModuleValue(tabId);
        const preferredModuleId = normalizeAdminModuleValue(options.preferredModuleId || options.scopeId || '');
        switch (normalizedTabId) {
            case 'overview':
                return 'growth-center';
            case 'growth':
            case 'content':
                return 'growth-center';
            case 'product':
            case 'product-detail':
            case 'ops':
            case 'monetization':
            case 'verify':
                return 'commerce-center';
            default:
                return preferredModuleId === 'commerce-center' ? 'commerce-center' : 'growth-center';
        }
    }

    function resolveAdminAnalyticsModuleConfig(moduleId = '', options = {}) {
        const normalizedModuleId = normalizeAdminModuleValue(moduleId);
        const baseConfig = ADMIN_ANALYTICS_MODULE_ALIASES[normalizedModuleId];
        if (!baseConfig) {
            return null;
        }

        const requestedTab = normalizeAdminModuleValue(options.analyticsTab || options.view || '');
        const sidebarModuleId = requestedTab
            ? getAdminAnalyticsSidebarModuleIdForTab(requestedTab, { preferredModuleId: baseConfig.sidebarModuleId })
            : baseConfig.sidebarModuleId;

        return {
            ...baseConfig,
            sidebarModuleId,
            routeModuleId: sidebarModuleId,
            defaultTab: requestedTab || baseConfig.defaultTab
        };
    }

    function getAdminSidebarModuleId(moduleId = '', options = {}) {
        const analyticsConfig = resolveAdminAnalyticsModuleConfig(moduleId, options);
        if (analyticsConfig) {
            return analyticsConfig.sidebarModuleId;
        }
        return normalizeAdminModuleValue(moduleId);
    }

    function normalizeAdminModuleId(moduleId) {
        const analyticsConfig = resolveAdminAnalyticsModuleConfig(moduleId);
        if (analyticsConfig) {
            return analyticsConfig.canonicalModuleId;
        }
        return normalizeAdminModuleValue(moduleId);
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
        const preferredSidebarModule = getAdminSidebarModuleId(preferredModule);
        if (preferredSidebarModule && hasModulePermission(preferredSidebarModule)) {
            return preferredSidebarModule;
        }

        const sidebarItems = document.querySelectorAll('.sidebar-item[data-module]');
        for (const item of sidebarItems) {
            const moduleId = normalizeAdminModuleValue(item.dataset.module);
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
        const moduleId = normalizeAdminModuleValue(item.dataset.module);
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

    function warmOpsAlertsModuleData() {
        const loaders = [
            window.loadOpsAlertSettings,
            window.loadOpsAlertHealth,
            window.loadRecoveryReadiness,
            window.loadOpsAlertMonitor
        ].filter((loader) => typeof loader === 'function');

        loaders.forEach((loader) => {
            try {
                void Promise.resolve(loader()).catch((error) => {
                    console.warn('[AdminStudio] Ops alerts warm failed:', error);
                });
            } catch (error) {
                console.warn('[AdminStudio] Ops alerts warm failed:', error);
            }
        });
    }

    function warmXianyuFulfillmentModuleData() {
        try {
            void Promise.resolve(window.loadMarketplaceChannelSettings?.()).catch((error) => {
                console.warn('[AdminStudio] Xianyu fulfillment warm failed:', error);
            });
        } catch (error) {
            console.warn('[AdminStudio] Xianyu fulfillment warm failed:', error);
        }
    }

    function baseSwitchModule(moduleId) {
        const normalizedRequestedModuleId = normalizeAdminModuleValue(moduleId);
        const analyticsConfig = resolveAdminAnalyticsModuleConfig(normalizedRequestedModuleId);
        const normalizedModuleId = analyticsConfig?.canonicalModuleId || normalizeAdminModuleId(normalizedRequestedModuleId);
        const sidebarModuleId = analyticsConfig?.sidebarModuleId || normalizedRequestedModuleId || normalizedModuleId;
        const targetContainerModuleId = analyticsConfig?.routeModuleId || normalizedRequestedModuleId || normalizedModuleId;
        const clickedItem = document.querySelector(`[data-module="${sidebarModuleId}"]`)
            || document.querySelector(`[data-module="${normalizedModuleId}"]`);
        if (clickedItem && clickedItem.classList.contains('disabled')) {
            return false;
        }

        const activeModule = document.querySelector('.module-container.active');
        const activeContainerModuleId = activeModule?.id?.replace('module-', '') || null;
        const activeModuleId = normalizeAdminModuleId(activeContainerModuleId);
        const switchingBetweenAnalyticsContainers = activeModuleId === 'analytics' && normalizedModuleId === 'analytics';

        if (activeModuleId === 'analytics' && normalizedModuleId !== 'analytics') {
            window.teardownAnalyticsModule?.();
        }

        if (normalizedModuleId === 'analytics') {
            attachAnalyticsWorkspace(targetContainerModuleId);
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

        const target = document.getElementById(`module-${targetContainerModuleId}`)
            || document.getElementById(`module-${normalizedModuleId}`);
        if (target) {
            target.hidden = false;
            target.classList.add('active');

            if (normalizedModuleId === 'analytics' && !switchingBetweenAnalyticsContainers) window.initAnalyticsModule?.();
            if (normalizedModuleId === 'ops-alerts') {
                window.initSettingsModule?.({ bindListeners: true, loadConfig: false });
                window.initOpsAlertsModule?.();
                warmOpsAlertsModuleData();
            }
            if (normalizedModuleId === 'xianyu-fulfillment') {
                window.initSettingsModule?.({ bindListeners: true, loadConfig: false });
                warmXianyuFulfillmentModuleData();
            }
            if (normalizedModuleId === 'comments') {
                window.initCommentsModule?.();
            }
        }

        closeMobileSidebar();
        scheduleAdminModulePrefetch(normalizedModuleId);
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

    function syncAdminStudioModuleUrl(moduleName, options = {}) {
        const url = getAdminStudioUrlObject();
        if (!url || typeof window.history?.replaceState !== 'function') {
            return;
        }

        const normalizedModule = normalizeAdminModuleId(moduleName) || 'gallery';
        const analyticsConfig = resolveAdminAnalyticsModuleConfig(moduleName, options);
        if (normalizedModule === 'gallery') {
            url.searchParams.delete('module');
        } else {
            url.searchParams.set(
                'module',
                normalizedModule === 'analytics'
                    ? (analyticsConfig?.routeModuleId || 'growth-center')
                    : normalizeAdminModuleValue(moduleName)
            );
        }

        const nextRelativeUrl = `${url.pathname}${url.search}${url.hash}`;
        const currentRelativeUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        if (nextRelativeUrl !== currentRelativeUrl) {
            window.history.replaceState(window.history.state, '', nextRelativeUrl);
        }
    }

    function syncAdminStudioAnalyticsSidebar(tabId = '', options = {}) {
        const sidebarModuleId = getAdminAnalyticsSidebarModuleIdForTab(tabId, { preferredModuleId: options.preferredModuleId });
        const activeModuleId = normalizeAdminModuleId(
            document.querySelector('.module-container.active')?.id?.replace(/^module-/, '')
        );
        if (activeModuleId !== 'analytics' && options.force !== true) {
            return sidebarModuleId;
        }

        document.querySelectorAll('.sidebar-item[data-module]').forEach((item) => {
            if (!resolveAdminAnalyticsModuleConfig(item.dataset.module)) {
                return;
            }
            item.classList.toggle('active', item.dataset.module === sidebarModuleId);
        });

        if (options.syncUrl === true) {
            syncAdminStudioModuleUrl(sidebarModuleId, { analyticsTab: tabId });
        }

        return sidebarModuleId;
    }

    function getAnalyticsWorkspaceHostId(moduleId = '') {
        const normalizedModuleId = normalizeAdminModuleValue(moduleId);
        switch (normalizedModuleId) {
            case 'growth-center':
                return 'analyticsWorkspaceHostGrowthCenter';
            case 'commerce-center':
                return 'analyticsWorkspaceHostCommerceCenter';
            case 'business-overview':
            case 'business-center':
            case 'analytics-center':
            case 'analytics':
            default:
                return 'analyticsWorkspaceHostBusinessOverview';
        }
    }

    function attachAnalyticsWorkspace(moduleId = '') {
        const workspaceRoot = document.getElementById('analyticsWorkspaceRoot');
        if (!workspaceRoot) {
            return false;
        }

        const host = document.getElementById(getAnalyticsWorkspaceHostId(moduleId));
        if (!host) {
            return false;
        }

        if (workspaceRoot.parentElement !== host) {
            host.appendChild(workspaceRoot);
        }

        return true;
    }

    function activateAdminStudioModule(moduleName, options = {}) {
        const requestedModuleName = normalizeAdminModuleValue(moduleName) || 'gallery';
        const normalizedModuleName = normalizeAdminModuleId(requestedModuleName) || 'gallery';
        const analyticsConfig = resolveAdminAnalyticsModuleConfig(requestedModuleName, options);
        const analyticsTab = analyticsConfig?.defaultTab || normalizeAdminModuleValue(options.analyticsTab || '') || '';
        const analyticsSectionId = String(options.analyticsSectionId || '').trim();
        const analyticsPromptId = String(options.analyticsPromptId || '').trim();
        const analyticsProductId = String(options.analyticsProductId || '').trim();
        const analyticsDetailFocus = String(options.analyticsDetailFocus || '').trim();
        const isPlainCommerceEntry = normalizedModuleName === 'analytics'
            && analyticsConfig?.sidebarModuleId === 'commerce-center'
            && analyticsTab === 'product'
            && !analyticsSectionId
            && !analyticsPromptId
            && !analyticsProductId
            && !analyticsDetailFocus;

        if (isPlainCommerceEntry && typeof window.resetAnalyticsProductDetailRuntime === 'function') {
            window.resetAnalyticsProductDetailRuntime({ resetPanel: true });
        }

        if (normalizedModuleName === 'analytics' && analyticsTab && typeof window.syncAnalyticsRouteState === 'function') {
            window.syncAnalyticsRouteState({
                view: analyticsTab,
                sectionId: analyticsSectionId,
                promptId: analyticsPromptId,
                productId: analyticsProductId,
                detailFocus: analyticsDetailFocus
            }, {
                ensureAnalyticsModule: true
            });
        }

        if (normalizedModuleName === 'analytics' && analyticsTab && typeof window.switchAnalyticsTab === 'function') {
            window.switchAnalyticsTab(analyticsTab, {
                syncRoute: false,
                sectionId: analyticsSectionId
            });
        }

        const switched = baseSwitchModule(requestedModuleName);
        if (!switched) {
            return false;
        }

        if (normalizedModuleName === 'homepage' && typeof window.HomepageAdmin?.init === 'function') {
            window.HomepageAdmin.init();
        }

        syncAdminStudioModuleUrl(requestedModuleName, {
            analyticsTab
        });
        if (normalizedModuleName === 'analytics') {
            if (analyticsTab && typeof window.switchAnalyticsTab === 'function') {
                window.switchAnalyticsTab(analyticsTab, {
                    syncRoute: false,
                    sectionId: analyticsSectionId
                });
            }
            syncAdminStudioAnalyticsSidebar(analyticsTab || 'overview', { force: true });
        }
        if (isPlainCommerceEntry) {
            window.requestAnimationFrame(() => {
                window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
            });
        }
        setAdminModuleNoticeVisible(false);
        return true;
    }

    function restoreAdminStudioModuleFromUrl() {
        const url = getAdminStudioUrlObject();
        if (!url) {
            return 'gallery';
        }

        const requestedModule = normalizeAdminModuleValue(url.searchParams.get('module'));
        if (!requestedModule) {
            return 'gallery';
        }

        const analyticsConfig = resolveAdminAnalyticsModuleConfig(requestedModule);
        if (analyticsConfig) {
            return document.getElementById(`module-${analyticsConfig.sidebarModuleId || analyticsConfig.routeModuleId || analyticsConfig.canonicalModuleId}`)
                ? analyticsConfig.sidebarModuleId
                : 'gallery';
        }

        const normalizedModule = normalizeAdminModuleId(requestedModule);
        return document.getElementById(`module-${normalizedModule}`) ? requestedModule : 'gallery';
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
            const moduleId = normalizeAdminModuleValue(item.dataset.module);
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
            const preferredSidebarModule = getAdminSidebarModuleId(options.preferredModule || preferredModule);
            const preferredAccessible = preferredSidebarModule && hasModulePermission(preferredSidebarModule);

            if (preferredAccessible && preferredSidebarModule !== activeModule) {
                activateAdminStudioModule(preferredSidebarModule);
            } else if (!activeModule || !hasModulePermission(activeModule)) {
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

                    const action = String(element.dataset.adminAction || '').trim();
                    if (action && window.AdminSiteFilter?.actionRequiresWritableSite?.(action)) {
                        const writableSite = window.AdminSiteFilter.requireWritableSite({ action });
                        if (!writableSite) {
                            return;
                        }
                        element.dataset.adminWritableSite = writableSite;
                    }

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

        bindClick('[data-admin-action="tickets-toggle-overdue"]', async () => {
            await window.AdminTickets?.toggleQuickFilter?.('overdue');
        });

        bindClick('[data-admin-action="tickets-toggle-priority"]', async () => {
            await window.AdminTickets?.toggleQuickFilter?.('priority');
        });

        bindClick('[data-admin-action="tickets-toggle-mine"]', async () => {
            await window.AdminTickets?.toggleQuickFilter?.('mine');
        });

        bindClick('[data-admin-action="tickets-toggle-unassigned"]', async () => {
            await window.AdminTickets?.toggleQuickFilter?.('unassigned');
        });

        bindClick('[data-admin-action="tickets-open-overdue-queue"]', async () => {
            await window.AdminTickets?.openOverdueQueue?.();
        });

        bindClick('[data-admin-action="tickets-open-sla-settings"]', () => {
            window.AdminTickets?.openSlaSettings?.();
        });

        bindClick('[data-admin-action="tickets-refresh-overview"]', async () => {
            await window.AdminTickets?.refreshOverview?.();
        });

        bindClick('[data-admin-action="tickets-bulk-assign-self"]', async () => {
            await window.AdminTickets?.submitBulkAssignment?.('assign_self');
        });

        bindClick('[data-admin-action="tickets-bulk-clear-assignee"]', async () => {
            await window.AdminTickets?.submitBulkAssignment?.('clear');
        });

        bindClick('[data-admin-action="tickets-open-bulk-resolve"]', () => {
            window.AdminTickets?.openBulkProcessModal?.('RESOLVED');
        });

        bindClick('[data-admin-action="tickets-open-bulk-reject"]', () => {
            window.AdminTickets?.openBulkProcessModal?.('REJECTED');
        });

        bindClick('[data-admin-action="tickets-close-bulk-process-modal"]', () => {
            window.AdminTickets?.closeBulkProcessModal?.();
        });

        bindClick('[data-admin-action="tickets-submit-bulk-process"]', async () => {
            await window.AdminTickets?.submitBulkProcess?.();
        });

        bindClick('[data-admin-action="tickets-clear-selection"]', () => {
            window.AdminTickets?.clearSelectedTickets?.();
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

                if (window.AdminSiteFilter?.formRequiresWritableSite?.(formId)) {
                    const writableSite = window.AdminSiteFilter.requireWritableSite({ formId });
                    if (!writableSite) {
                        return;
                    }
                    form.dataset.adminWritableSite = writableSite;
                }

                await handler(event);
            });
        };

        bindSubmit('discountGenerateForm', async () => {
            await window.AdminDiscounts?.submitGenerate?.();
        });

        bindSubmit('ticketReplyForm', async () => {
            await window.AdminTickets?.submitReply?.();
        });

        const ticketSelectAllCheckbox = document.getElementById('ticketsSelectAllCheckbox');
        if (ticketSelectAllCheckbox) {
            ticketSelectAllCheckbox.addEventListener('change', () => {
                window.AdminTickets?.toggleSelectAllPage?.(Boolean(ticketSelectAllCheckbox.checked));
            });
        }

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

    function scheduleAdminStudioPendingWorkspaceRestore() {
        if (window.__adminStudioPendingWorkspaceRestoreRequested) {
            return;
        }

        if (typeof window.schedulePendingOpsAlertWorkspaceRestore !== 'function') {
            return;
        }

        window.__adminStudioPendingWorkspaceRestoreRequested = true;
        window.schedulePendingOpsAlertWorkspaceRestore();
    }

    function prewarmHomepageModule() {
        if (typeof window.HomepageAdmin?.prefetch !== 'function') {
            return false;
        }

        if (!hasModulePermission('homepage')) {
            return false;
        }

        void Promise.resolve(window.HomepageAdmin.prefetch()).catch((error) => {
            console.warn('[AdminStudio] Homepage prewarm failed:', error);
        });
        return true;
    }

    function scheduleHomepageModulePrewarm(activeModule = restoreAdminStudioModuleFromUrl()) {
        if (window.__homepageModulePrewarmScheduled) {
            return;
        }

        if (normalizeAdminModuleId(activeModule) !== 'homepage') {
            return;
        }

        if (!(window.adminStudioAccessGranted === true || window.isAdmin === true || window.isSuperAdmin === true)) {
            return;
        }

        if (!hasModulePermission('homepage')) {
            return;
        }

        const runPrewarm = () => {
            window.__homepageModulePrewarmScheduled = false;
            if (!prewarmHomepageModule()) {
                window.setTimeout(() => {
                    scheduleHomepageModulePrewarm();
                }, 240);
            }
        };

        window.__homepageModulePrewarmScheduled = true;

        if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(runPrewarm, { timeout: 1500 });
            return;
        }

        window.setTimeout(runPrewarm, 320);
    }

    function clearAdminModulePrefetch() {
        if (!window.__adminModulePrefetchHandle) {
            return;
        }

        if (window.__adminModulePrefetchMode === 'idle' && typeof window.cancelIdleCallback === 'function') {
            window.cancelIdleCallback(window.__adminModulePrefetchHandle);
        } else {
            window.clearTimeout(window.__adminModulePrefetchHandle);
        }

        window.__adminModulePrefetchHandle = 0;
        window.__adminModulePrefetchMode = '';
        window.__adminModulePrefetchTarget = '';
    }

    const ADMIN_BOOTSTRAP_MODULE_PREFETCH_ALLOWLIST = new Set([]);

    function getAdminModulePrefetcher(moduleId) {
        const normalizedModuleId = normalizeAdminModuleId(moduleId);
        switch (normalizedModuleId) {
            case 'gallery':
                return () => window.prefetchGalleryModule?.();
            case 'comments':
                return () => window.prefetchCommentsModule?.();
            case 'shop':
                return () => window.ShopAdmin?.scheduleShopTabPrefetch?.(window.ShopAdmin?.currentTab || 'products');
            case 'points':
                return () => window.prefetchPointsModule?.();
            case 'payments':
                return () => window.AdminPayments?.scheduleTabPrefetch?.(window.AdminPayments?.getActiveTab?.() || 'overview');
            case 'xianyu-fulfillment':
                return () => window.loadMarketplaceChannelSettings?.();
            case 'settings':
                return () => window.prefetchSettingsModule?.();
            case 'ops-alerts':
                return () => window.prefetchOpsAlertsModule?.();
            default:
                return null;
        }
    }

    function scheduleAdminModulePrefetch(moduleId) {
        const normalizedModuleId = normalizeAdminModuleId(moduleId);
        const prefetcher = getAdminModulePrefetcher(normalizedModuleId);

        clearAdminModulePrefetch();

        if (!normalizedModuleId || typeof prefetcher !== 'function') {
            return;
        }

        if (!(window.adminStudioAccessGranted === true || window.isAdmin === true || window.isSuperAdmin === true)) {
            return;
        }

        if (!hasModulePermission(normalizedModuleId)) {
            return;
        }

        // Most modules already hydrate their own secondary data after first paint.
        // Keep bootstrap-level prefetch conservative so switching modules does not
        // immediately fan out into sibling tabs, summaries, and background bundles.
        if (!ADMIN_BOOTSTRAP_MODULE_PREFETCH_ALLOWLIST.has(normalizedModuleId)) {
            return;
        }

        const runPrefetch = () => {
            window.__adminModulePrefetchHandle = 0;
            window.__adminModulePrefetchMode = '';

            const activeModule = normalizeAdminModuleId(
                document.querySelector('.module-container.active')?.id?.replace(/^module-/, '')
            );
            if (activeModule !== normalizedModuleId) {
                return;
            }

            try {
                void Promise.resolve(prefetcher()).catch((error) => {
                    console.warn(`[AdminStudio] Module prefetch failed for ${normalizedModuleId}:`, error);
                });
            } catch (error) {
                console.warn(`[AdminStudio] Module prefetch failed for ${normalizedModuleId}:`, error);
            }
        };

        window.__adminModulePrefetchTarget = normalizedModuleId;

        if (typeof window.requestIdleCallback === 'function') {
            window.__adminModulePrefetchMode = 'idle';
            window.__adminModulePrefetchHandle = window.requestIdleCallback(runPrefetch, { timeout: 2400 });
            return;
        }

        window.__adminModulePrefetchMode = 'timeout';
        window.__adminModulePrefetchHandle = window.setTimeout(runPrefetch, 600);
    }

    function switchModule(moduleName, options = {}) {
        const requestedModuleName = normalizeAdminModuleValue(moduleName) || 'gallery';
        const normalizedModuleName = normalizeAdminModuleId(requestedModuleName) || 'gallery';
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
                    activateAdminStudioModule(fallbackModule);
                }
            }
            return false;
        }

        return activateAdminStudioModule(requestedModuleName, options);
    }

    window.toggleMobileSidebar = toggleMobileSidebar;
    window.closeMobileSidebar = closeMobileSidebar;
    window.getAdminStudioUrlObject = getAdminStudioUrlObject;
    window.syncAdminStudioModuleUrl = syncAdminStudioModuleUrl;
    window.restoreAdminStudioModuleFromUrl = restoreAdminStudioModuleFromUrl;
    window.getAdminAnalyticsSidebarModuleIdForTab = getAdminAnalyticsSidebarModuleIdForTab;
    window.syncAdminStudioAnalyticsSidebar = syncAdminStudioAnalyticsSidebar;
    window.getAdminPermissionDefinition = getAdminPermissionDefinition;
    window.getAdminPermissionLabel = getAdminPermissionLabel;
    window.getAdminModuleDefinition = getAdminModuleDefinition;
    window.getModulePermissionRequirementText = getModulePermissionRequirementText;
    window.hasModulePermission = hasModulePermission;
    window.getFirstAccessibleAdminModule = getFirstAccessibleAdminModule;
    window.syncAdminStudioModuleAccess = syncAdminStudioModuleAccess;
    window.switchModule = switchModule;
    window.scheduleAdminModulePrefetch = scheduleAdminModulePrefetch;
    bindAdminStudioStaticFallbackControls();

    window.addEventListener('permissionsLoaded', () => {
        syncAdminStudioModuleAccess({
            preferredModule: restoreAdminStudioModuleFromUrl(),
            enforceActiveModule: true
        });
        scheduleAdminStudioPendingWorkspaceRestore();
        scheduleHomepageModulePrewarm(restoreAdminStudioModuleFromUrl());
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

        if (window.adminStudioAccessGranted === true || window.isAdmin === true || window.isSuperAdmin === true) {
            scheduleAdminStudioPendingWorkspaceRestore();
            scheduleHomepageModulePrewarm(initialModule);
            scheduleAdminModulePrefetch(initialModule);
        }
    });
}());
