(function () {
    'use strict';

    if (window.AdminShell?.version) {
        return;
    }

    const ADMIN_SHELL_VERSION = '20260410_ADMIN_SHELL_P1_1';
    const MODULE_ALIASES = Object.freeze({
        analytics: 'analytics',
        'analytics-center': 'analytics',
        'business-overview': 'business-overview',
        'growth-center': 'growth-center',
        'commerce-center': 'commerce-center'
    });
    const NATIVE_SITE_EVENT_MODULES = new Set([
        'comments',
        'gallery',
        'homepage',
        'points',
        'shop',
        'payments',
        'growth-center',
        'commerce-center'
    ]);

    const registeredModules = new Map();
    const registeredSiteHandlers = new Map();
    const initializedModules = new Set();
    const moduleContexts = new Map();
    const legacySwitchModule = typeof window.switchModule === 'function'
        ? window.switchModule.bind(window)
        : null;

    function sanitizeText(value, maxLength = 4000) {
        return String(value || '').trim().slice(0, Math.max(0, maxLength));
    }

    function normalizeModuleId(value) {
        const normalized = sanitizeText(value, 120).toLowerCase();
        if (!normalized) {
            return '';
        }
        return MODULE_ALIASES[normalized] || normalized;
    }

    function normalizePayloadObject(value) {
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    }

    function getActiveModuleId() {
        const activeContainer = document.querySelector('.module-container.active');
        const activeFromContainer = normalizeModuleId(activeContainer?.id?.replace(/^module-/, ''));
        if (activeFromContainer) {
            return activeFromContainer;
        }

        const activeItem = document.querySelector('.sidebar-item.active[data-module]');
        return normalizeModuleId(activeItem?.dataset?.module);
    }

    function getCurrentSite() {
        return sanitizeText(window.AdminSiteFilter?.getSiteFilter?.() || 'all', 20).toLowerCase() || 'all';
    }

    function buildReturnContext() {
        const activeModule = getActiveModuleId();
        return {
            module: activeModule,
            site: getCurrentSite()
        };
    }

    function normalizeContext(destination, context = {}, options = {}) {
        const rawContext = normalizePayloadObject(context);
        const focus = normalizePayloadObject(rawContext.focus);
        const filters = normalizePayloadObject(rawContext.filters);
        const payload = normalizePayloadObject(rawContext.payload);
        const meta = normalizePayloadObject(rawContext.meta);
        const returnTo = normalizePayloadObject(rawContext.returnTo || options.returnTo);
        const normalizedDestination = normalizeModuleId(destination || rawContext.destination);

        return {
            source: sanitizeText(rawContext.source || options.source || getActiveModuleId(), 120),
            destination: normalizedDestination,
            entity: sanitizeText(rawContext.entity || rawContext.entityType || rawContext.entity_type, 120),
            action: sanitizeText(rawContext.action || rawContext.intent || options.action, 120),
            reason: sanitizeText(rawContext.reason || options.reason, 180),
            site: sanitizeText(rawContext.site || getCurrentSite(), 20).toLowerCase() || 'all',
            focus: {
                ...focus,
                userId: sanitizeText(focus.userId || focus.user_id || rawContext.userId || rawContext.user_id, 160),
                commentId: sanitizeText(focus.commentId || focus.comment_id || rawContext.focusCommentId || rawContext.commentId || rawContext.comment_id, 160),
                promptId: sanitizeText(focus.promptId || focus.prompt_id || rawContext.promptId || rawContext.prompt_id, 160),
                ticketId: sanitizeText(focus.ticketId || focus.ticket_id || rawContext.ticketId || rawContext.ticket_id, 160),
                orderId: sanitizeText(focus.orderId || focus.order_id || rawContext.orderId || rawContext.order_id, 160),
                paymentOrderId: sanitizeText(focus.paymentOrderId || focus.payment_order_id || rawContext.paymentOrderId || rawContext.payment_order_id, 160)
            },
            filters,
            payload,
            meta,
            returnTo: Object.keys(returnTo).length ? returnTo : buildReturnContext(),
            raw: rawContext
        };
    }

    function settle(delayMs = 120) {
        return new Promise((resolve) => {
            window.setTimeout(resolve, Math.max(0, Number(delayMs) || 0));
        });
    }

    async function waitFor(factory, options = {}) {
        const attempts = Math.max(1, Number(options.attempts || 8) || 8);
        const delayMs = Math.max(0, Number(options.delayMs || 120) || 120);

        for (let attempt = 0; attempt < attempts; attempt += 1) {
            const value = typeof factory === 'function' ? factory() : null;
            if (value) {
                return value;
            }
            await settle(delayMs);
        }

        return null;
    }

    async function runModuleLifecycle(moduleId, method, ...args) {
        const module = registeredModules.get(normalizeModuleId(moduleId));
        const handler = module && typeof module[method] === 'function' ? module[method] : null;
        if (!handler) {
            return null;
        }

        return handler(...args);
    }

    async function deliverModuleContext(moduleId, context = {}, options = {}) {
        const normalizedModuleId = normalizeModuleId(moduleId);
        const normalizedContext = normalizeContext(normalizedModuleId, context, options);
        moduleContexts.set(normalizedModuleId, normalizedContext);

        try {
            const module = registeredModules.get(normalizedModuleId);
            if (module && !initializedModules.has(normalizedModuleId) && typeof module.init === 'function') {
                initializedModules.add(normalizedModuleId);
                await module.init(normalizedContext, options);
            }

            await runModuleLifecycle(normalizedModuleId, 'activate', normalizedContext, options);

            if (module && typeof module.handleContext === 'function') {
                await module.handleContext(normalizedContext, options);
            } else {
                await handleDefaultModuleContext(normalizedModuleId, normalizedContext, options);
            }

            window.dispatchEvent(new CustomEvent('admin-shell-context', {
                detail: {
                    moduleId: normalizedModuleId,
                    context: normalizedContext
                }
            }));
            return true;
        } catch (error) {
            console.warn(`[AdminShell] Failed to deliver context to ${normalizedModuleId}:`, error);
            return false;
        }
    }

    function registerModule(moduleId, lifecycle = {}) {
        const normalizedModuleId = normalizeModuleId(moduleId);
        if (!normalizedModuleId || !lifecycle || typeof lifecycle !== 'object') {
            return () => {};
        }

        const nextLifecycle = {
            ...registeredModules.get(normalizedModuleId),
            ...lifecycle
        };
        registeredModules.set(normalizedModuleId, nextLifecycle);

        if (typeof lifecycle.onSiteChange === 'function') {
            registerSiteChangeHandler(normalizedModuleId, lifecycle.onSiteChange);
        }

        return () => {
            const current = registeredModules.get(normalizedModuleId);
            if (current === nextLifecycle) {
                registeredModules.delete(normalizedModuleId);
            }
        };
    }

    function registerSiteChangeHandler(moduleId, handler) {
        const normalizedModuleId = normalizeModuleId(moduleId);
        if (!normalizedModuleId || typeof handler !== 'function') {
            return () => {};
        }

        registeredSiteHandlers.set(normalizedModuleId, handler);
        return () => {
            if (registeredSiteHandlers.get(normalizedModuleId) === handler) {
                registeredSiteHandlers.delete(normalizedModuleId);
            }
        };
    }

    function activateModule(moduleName, options = {}) {
        const requestedModuleName = sanitizeText(moduleName, 120) || 'gallery';
        const normalizedModuleId = normalizeModuleId(requestedModuleName) || 'gallery';
        const previousModuleId = getActiveModuleId();

        if (previousModuleId && previousModuleId !== normalizedModuleId) {
            void runModuleLifecycle(previousModuleId, 'deactivate', {
                nextModuleId: normalizedModuleId,
                reason: sanitizeText(options?.reason, 160)
            });
        }

        const switched = legacySwitchModule
            ? legacySwitchModule(requestedModuleName, options)
            : false;

        if (switched === false) {
            return false;
        }

        const rawContext = options?.context || options?.adminContext || options?.moduleContext || null;
        const shouldDeliverContext = rawContext && options?.deferContext !== true;
        if (shouldDeliverContext) {
            void deliverModuleContext(normalizedModuleId, rawContext, {
                reason: options?.reason || 'switch-module',
                returnTo: {
                    module: previousModuleId,
                    site: getCurrentSite()
                }
            });
        } else {
            void runModuleLifecycle(normalizedModuleId, 'activate', normalizeContext(normalizedModuleId, {}, options), options);
        }

        window.dispatchEvent(new CustomEvent('admin-shell-module-activated', {
            detail: {
                moduleId: normalizedModuleId,
                previousModuleId,
                options: normalizePayloadObject(options)
            }
        }));
        return true;
    }

    async function openContext(destination, context = {}, options = {}) {
        const normalizedDestination = normalizeModuleId(destination || context?.destination);
        if (!normalizedDestination) {
            return false;
        }

        const normalizedContext = normalizeContext(normalizedDestination, context, {
            ...options,
            returnTo: options?.returnTo || buildReturnContext()
        });
        const switched = activateModule(normalizedDestination, {
            ...(normalizePayloadObject(options?.switchOptions)),
            context: normalizedContext,
            deferContext: true,
            fallback: options?.fallback === true,
            silentDenied: options?.silentDenied,
            reason: normalizedContext.reason || 'open-context'
        });

        if (switched === false) {
            return false;
        }

        await settle(options?.settleMs ?? 140);
        return deliverModuleContext(normalizedDestination, normalizedContext, options);
    }

    async function handleDefaultModuleContext(moduleId, context = {}, options = {}) {
        const focus = normalizePayloadObject(context.focus);
        const payload = normalizePayloadObject(context.payload);
        const raw = normalizePayloadObject(context.raw);

        if (moduleId === 'users') {
            const userId = sanitizeText(focus.userId || raw.userId || raw.user_id, 160);
            const openUserModal = await waitFor(() => window.openUserModal, options);
            if (userId && typeof openUserModal === 'function') {
                const modalOptions = normalizePayloadObject(payload.modalOptions);
                await openUserModal(userId, {
                    ...modalOptions,
                    defaultTab: sanitizeText(payload.defaultTab || modalOptions.defaultTab || raw.defaultTab || raw.tab, 80),
                    analyticsContext: payload.analyticsContext || raw.analyticsContext || null,
                    paymentOrderId: sanitizeText(focus.paymentOrderId || payload.paymentOrderId || raw.paymentOrderId, 160),
                    fallbackEmail: sanitizeText(payload.email || raw.email || raw.userEmail || raw.user_email, 320),
                    silentOnNotFound: Boolean(payload.silentOnNotFound || raw.silentOnNotFound)
                });
                return true;
            }
        }

        if (moduleId === 'gallery') {
            const promptId = sanitizeText(focus.promptId || raw.promptId || raw.prompt_id || raw.id, 160);
            const openPromptContext = await waitFor(() => window.openAdminGalleryPromptContext, options);
            if (promptId && typeof openPromptContext === 'function') {
                openPromptContext(promptId, { ensureModule: false });
                return true;
            }
        }

        if (moduleId === 'comments') {
            const commentContext = {
                ...raw,
                ...payload,
                view: raw.view || raw.commentView || raw.comment_view || payload.view || payload.commentView,
                queue: raw.queue || payload.queue,
                search: raw.search || payload.search,
                promptId: focus.promptId || raw.promptId || raw.prompt_id || payload.promptId,
                promptTitle: raw.promptTitle || raw.prompt_title || payload.promptTitle,
                focusCommentId: focus.commentId || raw.focusCommentId || raw.commentId || raw.comment_id,
                commentId: focus.commentId || raw.commentId || raw.comment_id,
                site: context.site
            };
            const openUserCommentContext = await waitFor(() => window.openAdminUserCommentContext || window.openAnalyticsCommentContext, options);
            if (typeof openUserCommentContext === 'function') {
                openUserCommentContext({
                    ...commentContext,
                    ensureModule: false
                });
                return true;
            }
        }

        if (moduleId === 'tickets') {
            const ticketId = sanitizeText(focus.ticketId || raw.ticketId || raw.ticket_id, 160);
            const adminTickets = await waitFor(() => window.AdminTickets, options);
            if (adminTickets?.init) {
                await adminTickets.init();
            }
            if (ticketId && adminTickets?.focusTicket) {
                await adminTickets.focusTicket(ticketId, {
                    status: sanitizeText(payload.status || raw.status || 'all', 40) || 'all'
                });
                return true;
            }
        }

        if (moduleId === 'payments') {
            const paymentOrderId = sanitizeText(focus.paymentOrderId || raw.paymentOrderId || raw.payment_order_id, 160);
            const adminPayments = await waitFor(() => window.AdminPayments, options);
            if (adminPayments?.init) {
                await adminPayments.init();
            }
            if (paymentOrderId && adminPayments?.focusOrder) {
                await adminPayments.focusOrder(paymentOrderId, { switchTab: true, reload: true });
                return true;
            }
        }

        return false;
    }

    function runDefaultSiteChangeHandler(moduleId, detail = {}) {
        const normalizedModuleId = normalizeModuleId(moduleId);
        if (!normalizedModuleId) {
            return false;
        }

        if (NATIVE_SITE_EVENT_MODULES.has(normalizedModuleId)) {
            return true;
        }

        if (normalizedModuleId === 'analytics' || normalizedModuleId === 'business-overview') {
            if (typeof window.reloadAnalyticsDashboard === 'function') {
                window.reloadAnalyticsDashboard({ reason: 'site-change' });
            } else if (typeof window.initAnalyticsModule === 'function') {
                window.initAnalyticsModule();
            }
            return true;
        }

        if (normalizedModuleId === 'users') {
            window.loadUsers?.();
            return true;
        }

        if (normalizedModuleId === 'tickets') {
            if (window.AdminTickets?.loadTickets) {
                void window.AdminTickets.loadTickets({
                    page: window.AdminTickets.currentPage || 1,
                    status: window.AdminTickets.currentStatus || 'all',
                    searchQuery: window.AdminTickets.searchQuery || ''
                });
            } else {
                void window.AdminTickets?.init?.({ force: true });
            }
            return true;
        }

        if (normalizedModuleId === 'chat') {
            if (window.AdminChat) {
                const chatContainer = document.getElementById('chat-admin-container');
                if (chatContainer) {
                    window.adminChatInstance = new window.AdminChat(chatContainer);
                }
            }
            return true;
        }

        if (normalizedModuleId === 'settings' || normalizedModuleId === 'discounts' || normalizedModuleId === 'ops-alerts') {
            window.dispatchEvent(new CustomEvent('admin-shell-site-reload-requested', {
                detail: {
                    moduleId: normalizedModuleId,
                    site: detail?.site || getCurrentSite()
                }
            }));
            return true;
        }

        return false;
    }

    function handleSiteChange(detail = {}) {
        const activeModuleId = getActiveModuleId();
        const normalizedDetail = normalizePayloadObject(detail);
        window.dispatchEvent(new CustomEvent('admin-shell-site-changed', {
            detail: {
                ...normalizedDetail,
                activeModuleId
            }
        }));

        const handler = registeredSiteHandlers.get(activeModuleId);
        if (typeof handler === 'function') {
            try {
                void Promise.resolve(handler(normalizedDetail)).catch((error) => {
                    console.warn(`[AdminShell] Site change handler failed for ${activeModuleId}:`, error);
                });
                return true;
            } catch (error) {
                console.warn(`[AdminShell] Site change handler failed for ${activeModuleId}:`, error);
                return true;
            }
        }

        return runDefaultSiteChangeHandler(activeModuleId, normalizedDetail);
    }

    function switchModule(moduleName, options = {}) {
        return activateModule(moduleName, normalizePayloadObject(options));
    }

    window.AdminShell = {
        version: ADMIN_SHELL_VERSION,
        activateModule,
        deliverModuleContext,
        getActiveModuleId,
        getContext(moduleId) {
            return moduleContexts.get(normalizeModuleId(moduleId)) || null;
        },
        handleSiteChange,
        normalizeContext,
        normalizeModuleId,
        openContext,
        registerModule,
        registerSiteChangeHandler,
        settle,
        switchModule
    };

    window.registerAdminModule = registerModule;
    window.openAdminModuleContext = openContext;
    window.switchModule = switchModule;
})();
