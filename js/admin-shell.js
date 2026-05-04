(function () {
    'use strict';

    if (window.AdminShell?.version) {
        return;
    }

    const ADMIN_SHELL_VERSION = '20260426_ADMIN_SHELL_LOADING_DOTS_CENTER_P1';
    const ADMIN_LOADING_BRIDGE_SELECTOR = [
        '#analysisLoading',
        '#hp-loading',
        '#cfgVerifyQuota',
        '#opsAlertMonitorMeta',
        '#opsAlertHealthMeta',
        '#paymentsOpsAlertQueueMeta',
        '.loading-text',
        '.verify-monitor-empty',
        '.admin-audit-monitor-empty',
        '.loading-cell',
        '.shop-inventory-loading-cell',
        '.ai-loading',
        '.comment-detail-drawer__empty',
        '.comment-detail-drawer__empty-inline',
        '.shop-delivery-empty',
        '.shop-delivery-table-note',
        '.config-inline-note',
        '.ops-alert-monitor-empty',
        '.ops-alert-overview-empty',
        '.session-empty-state',
        '#importProductTree > div',
        'td.text-center',
        'span[id$="Meta"]'
    ].join(', ');
    const ADMIN_LOADING_TEXT_PATTERN = /(?:加载中|正在加载|分析中|生成中|查询中|同步中|校验中|准备中|补齐中|拉取中|获取中|刷新中)/;
    const ADMIN_LOADING_NEGATIVE_PATTERN = /(?:失败|错误|异常|暂无|没有|未联动|未找到|无数据|无可用|等待加载)/;
    const MODULE_ALIASES = Object.freeze({
        analytics: 'analytics',
        'analytics-center': 'analytics',
        'business-overview': 'business-overview',
        'growth-center': 'growth-center',
        'commerce-center': 'commerce-center'
    });
    const NATIVE_SITE_EVENT_MODULES = new Set([]);

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

    function escapeHtml(value) {
        return String(value || '').replace(/[&<>"']/g, (char) => {
            if (char === '&') return '&amp;';
            if (char === '<') return '&lt;';
            if (char === '>') return '&gt;';
            if (char === '"') return '&quot;';
            return '&#39;';
        });
    }

    function isHtmlElement(value) {
        return value instanceof window.HTMLElement;
    }

    function normalizeLoadingDotsVariant(value) {
        const normalized = sanitizeText(value, 16).toLowerCase();
        if (normalized === 'hero' || normalized === 'inline' || normalized === 'cell') {
            return normalized;
        }
        return 'block';
    }

    function buildLoadingDotsInnerMarkup(variant = 'block') {
        const normalizedVariant = normalizeLoadingDotsVariant(variant);
        return `<span class="admin-module-loading-dots admin-module-loading-dots--${normalizedVariant}" aria-hidden="true"><span></span><span></span><span></span></span>`;
    }

    function buildLoadingDotsMarkup(message = '', options = {}) {
        const variant = normalizeLoadingDotsVariant(options.variant);
        const tagName = ['div', 'span', 'p'].includes(String(options.tagName || '').trim().toLowerCase())
            ? String(options.tagName || '').trim().toLowerCase()
            : variant === 'inline'
                ? 'span'
                : 'div';
        const label = escapeHtml(sanitizeText(message || options.label || '加载中...', 240) || '加载中...');
        return `<${tagName} class="admin-module-loading-host admin-module-loading-host--${variant}" role="status" aria-live="polite" aria-label="${label}">${buildLoadingDotsInnerMarkup(variant)}</${tagName}>`;
    }

    function isLoadingBridgeCandidate(element) {
        return isHtmlElement(element) && typeof element.matches === 'function' && element.matches(ADMIN_LOADING_BRIDGE_SELECTOR);
    }

    function elementHasLoadingDots(element) {
        if (!isHtmlElement(element)) {
            return false;
        }
        return Boolean(element.firstElementChild && element.firstElementChild.classList.contains('admin-module-loading-dots'));
    }

    function getLoadingIndicatorLabel(element) {
        if (!isHtmlElement(element)) {
            return '加载中...';
        }

        const explicitLabel = sanitizeText(
            element.getAttribute('aria-label')
            || element.getAttribute('data-admin-loading-label')
            || '',
            240
        );
        if (explicitLabel) {
            return explicitLabel;
        }

        if (element.id === 'analysisLoading') {
            return 'AI 分析加载中...';
        }
        if (element.id === 'hp-loading') {
            return '加载主页配置中...';
        }
        if (element.id === 'cfgVerifyQuota') {
            return '查询中...';
        }

        const textLabel = sanitizeText(element.textContent || '', 240);
        return textLabel || '加载中...';
    }

    function elementHasLoadingSignal(element) {
        if (!isHtmlElement(element)) {
            return false;
        }

        if (elementHasLoadingDots(element)) {
            return true;
        }

        if (element.id === 'analysisLoading') {
            return true;
        }

        if (element.querySelector('.fa-spin, .neural-loader')) {
            return true;
        }

        const label = sanitizeText(element.textContent || '', 240);
        return Boolean(label) && ADMIN_LOADING_TEXT_PATTERN.test(label) && !ADMIN_LOADING_NEGATIVE_PATTERN.test(label);
    }

    function resolveLoadingDotsVariant(element, options = {}) {
        const explicitVariant = normalizeLoadingDotsVariant(options.variant);
        if (explicitVariant !== 'block') {
            return explicitVariant;
        }

        if (!isHtmlElement(element)) {
            return 'block';
        }

        if (element.id === 'analysisLoading' || element.id === 'hp-loading') {
            return 'hero';
        }

        if (element.matches('td, .loading-cell, .shop-inventory-loading-cell')) {
            return 'cell';
        }

        if (
            element.id === 'cfgVerifyQuota'
            || element.matches('.config-inline-note, .shop-delivery-table-note, .comment-detail-drawer__empty-inline')
            || (element.tagName === 'SPAN' && /Meta$/.test(element.id || ''))
        ) {
            return 'inline';
        }

        return 'block';
    }

    function shouldManageLoadingBridgeElement(element) {
        if (!isLoadingBridgeCandidate(element)) {
            return false;
        }

        const excludedAncestor = element.closest('button, [role="button"], .admin-command-center__action, .sidebar-item, .admin-tab');
        if (excludedAncestor && excludedAncestor !== element) {
            return false;
        }

        return elementHasLoadingSignal(element);
    }

    function applyLoadingDotsState(element, options = {}) {
        if (!isHtmlElement(element)) {
            return false;
        }

        const variant = resolveLoadingDotsVariant(element, options);
        const label = sanitizeText(options.label || getLoadingIndicatorLabel(element), 240) || '加载中...';
        const variantClasses = [
            'admin-module-loading-host--block',
            'admin-module-loading-host--inline',
            'admin-module-loading-host--cell',
            'admin-module-loading-host--hero'
        ];

        element.classList.add('admin-module-loading-host');
        variantClasses.forEach((className) => element.classList.remove(className));
        element.classList.add(`admin-module-loading-host--${variant}`);
        element.dataset.adminLoadingDotsState = 'true';
        element.dataset.adminLoadingDotsVariant = variant;
        element.dataset.adminLoadingLabel = label;
        element.setAttribute('role', 'status');
        element.setAttribute('aria-live', 'polite');
        element.setAttribute('aria-label', label);

        if (!elementHasLoadingDots(element) || element.dataset.adminLoadingDotsVariant !== variant) {
            element.innerHTML = buildLoadingDotsInnerMarkup(variant);
        }
        return true;
    }

    function clearLoadingDotsState(element) {
        if (!isHtmlElement(element)) {
            return false;
        }

        element.classList.remove(
            'admin-module-loading-host',
            'admin-module-loading-host--block',
            'admin-module-loading-host--inline',
            'admin-module-loading-host--cell',
            'admin-module-loading-host--hero'
        );
        delete element.dataset.adminLoadingDotsState;
        delete element.dataset.adminLoadingDotsVariant;
        delete element.dataset.adminLoadingLabel;
        element.removeAttribute('role');
        element.removeAttribute('aria-live');
        element.removeAttribute('aria-label');
        return true;
    }

    function syncLoadingDotsState(element) {
        if (!isLoadingBridgeCandidate(element)) {
            return false;
        }

        if (shouldManageLoadingBridgeElement(element)) {
            return applyLoadingDotsState(element);
        }

        if (element.classList.contains('admin-module-loading-host')) {
            clearLoadingDotsState(element);
        }
        return false;
    }

    function collectLoadingBridgeCandidates(root, bucket = new Set()) {
        if (!root) {
            return bucket;
        }

        const element = root.nodeType === Node.ELEMENT_NODE
            ? root
            : root.parentElement;

        if (!isHtmlElement(element)) {
            return bucket;
        }

        if (typeof element.closest === 'function') {
            const closestCandidate = element.closest(ADMIN_LOADING_BRIDGE_SELECTOR);
            if (closestCandidate) {
                bucket.add(closestCandidate);
            }
        }

        if (isLoadingBridgeCandidate(element)) {
            bucket.add(element);
        }

        if (typeof element.querySelectorAll === 'function') {
            element.querySelectorAll(ADMIN_LOADING_BRIDGE_SELECTOR).forEach((candidate) => {
                bucket.add(candidate);
            });
        }

        return bucket;
    }

    let loadingDotsObserver = null;
    let loadingDotsRefreshScheduled = false;
    const pendingLoadingDotsRoots = new Set();

    function flushLoadingDotsBridge() {
        loadingDotsRefreshScheduled = false;
        const candidates = new Set();
        if (!pendingLoadingDotsRoots.size && document.body) {
            pendingLoadingDotsRoots.add(document.body);
        }

        pendingLoadingDotsRoots.forEach((root) => collectLoadingBridgeCandidates(root, candidates));
        pendingLoadingDotsRoots.clear();
        candidates.forEach((candidate) => {
            syncLoadingDotsState(candidate);
        });
    }

    function queueLoadingDotsRefresh(root = document.body) {
        if (root) {
            pendingLoadingDotsRoots.add(root);
        }
        if (loadingDotsRefreshScheduled) {
            return;
        }

        loadingDotsRefreshScheduled = true;
        const schedule = typeof window.requestAnimationFrame === 'function'
            ? window.requestAnimationFrame.bind(window)
            : (callback) => window.setTimeout(callback, 16);
        schedule(flushLoadingDotsBridge);
    }

    function startLoadingDotsBridgeObserver() {
        if (loadingDotsObserver || !document.body) {
            return;
        }

        if (typeof MutationObserver !== 'function') {
            queueLoadingDotsRefresh(document.body);
            return;
        }

        loadingDotsObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                queueLoadingDotsRefresh(mutation.target);
                mutation.addedNodes.forEach((node) => queueLoadingDotsRefresh(node));
            });
        });

        loadingDotsObserver.observe(document.body, {
            subtree: true,
            childList: true,
            characterData: true
        });
        queueLoadingDotsRefresh(document.body);
    }

    function initializeLoadingDotsBridge() {
        if (window.__adminLoadingDotsBridgeInitialized === true) {
            return;
        }
        window.__adminLoadingDotsBridgeInitialized = true;

        if (typeof document !== 'object' || !document) {
            return;
        }

        if (document.body) {
            startLoadingDotsBridgeObserver();
            return;
        }

        if (typeof document.addEventListener !== 'function') {
            return;
        }

        document.addEventListener('DOMContentLoaded', () => {
            startLoadingDotsBridgeObserver();
        }, { once: true });
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

    function normalizeDeliveryResult(result, options = {}) {
        const payload = normalizePayloadObject(result);
        const hasCustomHandler = options?.hasCustomHandler === true;
        const handled = result === false
            ? false
            : hasCustomHandler
                || result === true
                || payload.handled === true
                || payload.opened === true
                || payload.matched === true
                || payload.ok === true;

        return {
            handled,
            status: handled ? 'delivered' : 'unhandled',
            opened: payload.opened === true,
            matched: payload.matched === true,
            reason: sanitizeText(payload.reason || payload.message || '', 180),
            at: Date.now()
        };
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

    async function activateLegacyModuleRuntime(moduleRuntime, context = {}, options = {}) {
        if (!moduleRuntime || typeof moduleRuntime !== 'object') {
            return false;
        }

        if (typeof moduleRuntime.activate === 'function') {
            await moduleRuntime.activate(context, options);
            return true;
        }

        if (typeof moduleRuntime.init === 'function') {
            await moduleRuntime.init(options);
            return true;
        }

        return false;
    }

    async function deliverModuleContext(moduleId, context = {}, options = {}) {
        const normalizedModuleId = normalizeModuleId(moduleId);
        const normalizedContext = normalizeContext(normalizedModuleId, context, options);
        moduleContexts.set(normalizedModuleId, normalizedContext);

        try {
            const module = registeredModules.get(normalizedModuleId);
            const hasCustomHandler = module && typeof module.handleContext === 'function';
            let deliveryResult = false;
            if (module && !initializedModules.has(normalizedModuleId) && typeof module.init === 'function') {
                initializedModules.add(normalizedModuleId);
                await module.init(normalizedContext, options);
            }

            await runModuleLifecycle(normalizedModuleId, 'activate', normalizedContext, options);

            if (hasCustomHandler) {
                deliveryResult = await module.handleContext(normalizedContext, options);
            } else {
                deliveryResult = await handleDefaultModuleContext(normalizedModuleId, normalizedContext, options);
            }

            const delivery = normalizeDeliveryResult(deliveryResult, { hasCustomHandler });
            window.dispatchEvent(new CustomEvent('admin-shell-context', {
                detail: {
                    moduleId: normalizedModuleId,
                    context: normalizedContext,
                    delivery
                }
            }));
            return true;
        } catch (error) {
            console.warn(`[AdminShell] Failed to deliver context to ${normalizedModuleId}:`, error);
            window.dispatchEvent(new CustomEvent('admin-shell-context', {
                detail: {
                    moduleId: normalizedModuleId,
                    context: normalizedContext,
                    delivery: {
                        handled: false,
                        status: 'failed',
                        reason: 'context-handler-failed',
                        at: Date.now()
                    }
                }
            }));
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
            const openCommentsShellContext = await waitFor(() => window.openAdminCommentsShellContext, options);
            if (typeof openCommentsShellContext === 'function') {
                await openCommentsShellContext({
                    source: context.source,
                    entity: context.entity || 'comment',
                    action: context.action || (commentContext.focusCommentId ? 'focus-comment' : 'open-comments'),
                    site: context.site,
                    focus: {
                        commentId: commentContext.focusCommentId,
                        comment_id: commentContext.focusCommentId,
                        promptId: commentContext.promptId,
                        prompt_id: commentContext.promptId
                    },
                    payload: {
                        ...commentContext,
                        commentView: commentContext.view
                    }
                }, options);
                return true;
            }
            const openUserCommentContext = await waitFor(() => window.openAdminUserCommentContext || window.openAnalyticsCommentContext, options);
            if (typeof openUserCommentContext === 'function') {
                openUserCommentContext({
                    ...commentContext,
                    ensureModule: false
                });
                return true;
            }
        }

        if (moduleId === 'shop') {
            const orderId = sanitizeText(focus.orderId || raw.orderId || raw.order_id, 160);
            const inventoryId = sanitizeText(focus.inventoryId || raw.inventoryId || raw.inventory_id, 160);
            const productId = sanitizeText(focus.productId || raw.productId || raw.product_id, 160);
            const shopWorkspace = sanitizeText(
                payload.workspace
                || raw.workspace
                || payload.defaultTab
                || payload.tab
                || raw.defaultTab
                || raw.tab
                || 'products',
                60
            ) || 'products';
            const adminShop = await waitFor(() => window.ShopAdmin, options);
            await activateLegacyModuleRuntime(adminShop, context, {
                defaultTab: shopWorkspace,
                tab: shopWorkspace
            });
            if (orderId && adminShop?.focusOrder) {
                await adminShop.focusOrder(orderId, {
                    openDetails: payload.openDetails !== false,
                    context: Object.keys(payload).length ? payload : raw
                });
                return true;
            }
            if (inventoryId && adminShop?.showInventoryDetail) {
                await adminShop.showInventoryDetail(inventoryId);
                return true;
            }
            if (productId && adminShop?.editProduct) {
                await adminShop.editProduct(productId);
                return true;
            }
        }

        if (moduleId === 'tickets') {
            const ticketId = sanitizeText(focus.ticketId || raw.ticketId || raw.ticket_id, 160);
            const adminTickets = await waitFor(() => window.AdminTickets, options);
            await activateLegacyModuleRuntime(adminTickets, context, {
                workspace: payload.workspace || raw.workspace || 'queue'
            });
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
            await activateLegacyModuleRuntime(adminPayments, context, {
                defaultTab: payload.defaultTab || payload.tab || raw.defaultTab || raw.tab || 'overview',
                tab: payload.tab || payload.defaultTab || raw.tab || raw.defaultTab || 'overview'
            });
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

        if (normalizedModuleId === 'comments') {
            if (typeof window.handleAdminCommentsSiteChange === 'function') {
                void Promise.resolve(window.handleAdminCommentsSiteChange(detail)).catch((error) => {
                    console.warn('[AdminShell] Comments site change handler failed:', error);
                });
            } else {
                if (typeof window.loadComments === 'function') {
                    const view = window.currentCommentView || 'guestbook';
                    window.loadComments(view);
                }
                window.loadCommentStats?.();
            }
            return true;
        }

        if (normalizedModuleId === 'gallery') {
            if (typeof window.handleAdminGallerySiteChange === 'function') {
                void Promise.resolve(window.handleAdminGallerySiteChange(detail)).catch((error) => {
                    console.warn('[AdminShell] Gallery site change handler failed:', error);
                });
            } else if (typeof window.loadAdminPrompts === 'function') {
                window.loadAdminPrompts();
            }
            return true;
        }

        if (normalizedModuleId === 'analytics' || normalizedModuleId === 'business-overview' || normalizedModuleId === 'commerce-center') {
            if (typeof window.handleAdminAnalyticsSiteChange === 'function') {
                void Promise.resolve(window.handleAdminAnalyticsSiteChange({
                    ...detail,
                    activeModuleId: normalizedModuleId
                })).catch((error) => {
                    console.warn('[AdminShell] Analytics site change handler failed:', error);
                });
                return true;
            }
            if (typeof window.reloadAnalyticsDashboard === 'function') {
                window.reloadAnalyticsDashboard({ reason: 'site-change' });
            } else if (typeof window.initAnalyticsModule === 'function') {
                window.initAnalyticsModule();
            }
            return true;
        }

        if (normalizedModuleId === 'users') {
            if (typeof window.handleAdminUsersSiteChange === 'function') {
                void Promise.resolve(window.handleAdminUsersSiteChange()).catch((error) => {
                    console.warn('[AdminShell] Users site change handler failed:', error);
                });
            } else {
                window.loadUsers?.();
            }
            return true;
        }

        if (normalizedModuleId === 'homepage') {
            if (typeof window.handleAdminHomepageSiteChange === 'function') {
                void Promise.resolve(window.handleAdminHomepageSiteChange(detail)).catch((error) => {
                    console.warn('[AdminShell] Homepage site change handler failed:', error);
                });
                return true;
            }
            return false;
        }

        if (normalizedModuleId === 'points') {
            if (typeof window.handleAdminPointsSiteChange === 'function') {
                void Promise.resolve(window.handleAdminPointsSiteChange(detail)).catch((error) => {
                    console.warn('[AdminShell] Points site change handler failed:', error);
                });
                return true;
            }
            return false;
        }

        if (normalizedModuleId === 'shop') {
            if (typeof window.handleAdminShopSiteChange === 'function') {
                void Promise.resolve(window.handleAdminShopSiteChange(detail)).catch((error) => {
                    console.warn('[AdminShell] Shop site change handler failed:', error);
                });
            } else if (window.ShopAdmin) {
                if (typeof window.ShopAdmin.handleSiteChange === 'function') {
                    window.ShopAdmin.handleSiteChange(detail);
                } else {
                    if (typeof window.ShopAdmin.searchOrders === 'function') window.ShopAdmin.searchOrders();
                    if (typeof window.ShopAdmin.loadProducts === 'function') window.ShopAdmin.loadProducts();
                }
            }
            return true;
        }

        if (normalizedModuleId === 'payments') {
            if (typeof window.handleAdminPaymentsSiteChange === 'function') {
                void Promise.resolve(window.handleAdminPaymentsSiteChange(detail)).catch((error) => {
                    console.warn('[AdminShell] Payments site change handler failed:', error);
                });
            } else if (window.AdminPayments && typeof window.AdminPayments.reload === 'function') {
                window.AdminPayments.reload();
            }
            return true;
        }

        if (normalizedModuleId === 'tickets') {
            if (typeof window.handleAdminTicketsSiteChange === 'function') {
                void Promise.resolve(window.handleAdminTicketsSiteChange(detail)).catch((error) => {
                    console.warn('[AdminShell] Tickets site change handler failed:', error);
                });
            } else if (typeof window.AdminTickets?.handleShellSiteChange === 'function') {
                void window.AdminTickets.handleShellSiteChange(detail);
            } else if (window.AdminTickets?.loadTickets) {
                void window.AdminTickets.loadTickets({
                    page: window.AdminTickets.currentPage || 1,
                    status: window.AdminTickets.currentStatus || 'all',
                    searchQuery: window.AdminTickets.searchQuery || ''
                });
            }
            return true;
        }

        if (normalizedModuleId === 'chat') {
            if (typeof window.handleAdminChatModuleSiteChange === 'function') {
                void Promise.resolve(window.handleAdminChatModuleSiteChange()).catch((error) => {
                    console.warn('[AdminShell] Chat site change handler failed:', error);
                });
                return true;
            }

            const chatInstance = typeof window.ensureAdminChatInstance === 'function'
                ? window.ensureAdminChatInstance({ ensureLayout: true })
                : window.adminChatInstance;
            if (chatInstance?.fetchSessions) {
                void Promise.resolve(chatInstance.fetchSessions()).catch((error) => {
                    console.warn('[AdminShell] Chat session refresh failed:', error);
                });
                return true;
            }

            return false;
        }

        if (normalizedModuleId === 'engagement') {
            if (typeof window.handleAdminEngagementSiteChange === 'function') {
                void Promise.resolve(window.handleAdminEngagementSiteChange(detail)).catch((error) => {
                    console.warn('[AdminShell] Engagement site change handler failed:', error);
                });
                return true;
            }
            return false;
        }

        if (normalizedModuleId === 'growth-center') {
            if (typeof window.handleAdminGrowthCenterSiteChange === 'function') {
                void Promise.resolve(window.handleAdminGrowthCenterSiteChange(detail)).catch((error) => {
                    console.warn('[AdminShell] Growth center site change handler failed:', error);
                });
                return true;
            }
            return false;
        }

        if (normalizedModuleId === 'discounts') {
            if (typeof window.handleAdminDiscountsSiteChange === 'function') {
                void Promise.resolve(window.handleAdminDiscountsSiteChange(detail)).catch((error) => {
                    console.warn('[AdminShell] Discounts site change handler failed:', error);
                });
                return true;
            }
            return false;
        }

        if (normalizedModuleId === 'settings') {
            if (typeof window.handleAdminSettingsSiteChange === 'function') {
                void Promise.resolve(window.handleAdminSettingsSiteChange(detail)).catch((error) => {
                    console.warn('[AdminShell] Settings site change handler failed:', error);
                });
                return true;
            }
            return false;
        }

        if (normalizedModuleId === 'ops-alerts') {
            if (typeof window.handleAdminOpsAlertsSiteChange === 'function') {
                void Promise.resolve(window.handleAdminOpsAlertsSiteChange(detail)).catch((error) => {
                    console.warn('[AdminShell] Ops alerts site change handler failed:', error);
                });
                return true;
            }
            return false;
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

    initializeLoadingDotsBridge();

    window.AdminShell = {
        version: ADMIN_SHELL_VERSION,
        activateModule,
        applyLoadingDotsState,
        buildLoadingDotsMarkup,
        clearLoadingDotsState,
        deliverModuleContext,
        getActiveModuleId,
        getContext(moduleId) {
            return moduleContexts.get(normalizeModuleId(moduleId)) || null;
        },
        handleSiteChange,
        normalizeContext,
        normalizeDeliveryResult,
        normalizeModuleId,
        openContext,
        refreshLoadingDots(root = document.body) {
            queueLoadingDotsRefresh(root || document.body);
        },
        registerModule,
        registerSiteChangeHandler,
        settle,
        switchModule
    };

    window.registerAdminModule = registerModule;
    window.openAdminModuleContext = openContext;
    window.switchModule = switchModule;
})();
