(function initAdminRealSmoke(globalScope) {
    'use strict';

    const url = new URL(globalScope.location.href);
    if (url.searchParams.get('realSmoke') !== '1') {
        return;
    }

    const state = {
        startedAt: Date.now(),
        results: [],
        errors: [],
        completed: false,
        currentStep: 'booting'
    };

    function decodeProbePayload(rawValue = '') {
        const normalized = String(rawValue || '').trim();
        if (!normalized) return {};
        try {
            let payload = normalized.replace(/-/g, '+').replace(/_/g, '/');
            while (payload.length % 4 !== 0) {
                payload += '=';
            }
            return JSON.parse(globalScope.atob(payload));
        } catch (_) {
            return {};
        }
    }

    const expectedRole = String(url.searchParams.get('realSmokeRole') || 'super').trim().toLowerCase() || 'super';
    const probe = decodeProbePayload(url.searchParams.get('probe'));

    function ensureResultPanel() {
        let panel = globalScope.document.getElementById('realSmokeResult');
        if (panel) return panel;

        panel = globalScope.document.createElement('section');
        panel.id = 'realSmokeResult';
        panel.className = 'config-inline-note points-module-note';
        panel.setAttribute('aria-live', 'polite');

        const title = globalScope.document.createElement('strong');
        title.textContent = 'Real Login Smoke';

        const meta = globalScope.document.createElement('span');
        meta.id = 'realSmokeMeta';
        meta.textContent = 'booting';

        const log = globalScope.document.createElement('pre');
        log.id = 'realSmokeLog';
        log.textContent = 'booting';

        panel.appendChild(title);
        panel.appendChild(globalScope.document.createTextNode(' '));
        panel.appendChild(meta);
        panel.appendChild(log);
        globalScope.document.body.prepend(panel);
        return panel;
    }

    const resultPanel = ensureResultPanel();
    const resultMeta = globalScope.document.getElementById('realSmokeMeta');
    const resultLog = globalScope.document.getElementById('realSmokeLog');

    function render() {
        const failed = state.results.some((item) => item.pass === false) || state.errors.length > 0;
        const status = failed ? 'failed' : (state.completed ? 'passed' : 'running');
        resultPanel.dataset.realSmokeStatus = status;
        if (resultMeta) {
            resultMeta.textContent = `${status} · ${state.results.length} checks`;
        }
        if (resultLog) {
            const lines = [];
            lines.push(`role=${expectedRole}`);
            if (probe.chatSessionId) lines.push(`chatSessionId=${probe.chatSessionId}`);
            if (probe.orderId) lines.push(`orderId=${probe.orderId}`);
            if (probe.paymentId) lines.push(`paymentId=${probe.paymentId}`);
            if (probe.ticketId) lines.push(`ticketId=${probe.ticketId}`);
            if (probe.userId) lines.push(`userId=${probe.userId}`);
            if (state.currentStep) lines.push(`currentStep=${state.currentStep}`);
            lines.push('');
            state.results.forEach((item) => {
                lines.push(`${item.pass ? 'PASS' : 'FAIL'} ${item.label}${item.detail ? ` :: ${item.detail}` : ''}`);
            });
            if (state.errors.length) {
                lines.push('');
                lines.push('Errors:');
                state.errors.forEach((item) => lines.push(`- ${item}`));
            }
            resultLog.textContent = lines.join('\n');
        }
        globalScope.__adminRealSmoke = {
            expectedRole,
            probe,
            status,
            results: [...state.results],
            errors: [...state.errors]
        };
    }

    function markStep(stepLabel) {
        state.currentStep = String(stepLabel || '').trim() || state.currentStep || 'running';
        render();
    }

    function captureError(prefix, error) {
        const message = error?.message || error?.reason?.message || String(error?.reason || error || '').trim();
        if (!message) return;
        const normalized = `${prefix}: ${message}`;
        if (!state.errors.includes(normalized)) {
            state.errors.push(normalized);
            render();
        }
    }

    const originalConsoleError = globalScope.console?.error?.bind(globalScope.console);
    if (globalScope.console && typeof globalScope.console.error === 'function') {
        globalScope.console.error = function patchedConsoleError(...args) {
            captureError('console.error', args.map((item) => item?.message || String(item || '')).join(' | '));
            return originalConsoleError(...args);
        };
    }
    globalScope.addEventListener('error', (event) => captureError('window.error', event?.error || event?.message || 'error'));
    globalScope.addEventListener('unhandledrejection', (event) => captureError('unhandledrejection', event?.reason || 'rejection'));

    function record(pass, label, detail = '') {
        state.results.push({
            pass: pass === true,
            label: String(label || '').trim(),
            detail: String(detail || '').trim()
        });
        render();
    }

    function isElementVisible(element) {
        if (!(element instanceof globalScope.HTMLElement)) return false;
        if (element.hidden) return false;
        const styles = globalScope.getComputedStyle(element);
        return styles.display !== 'none'
            && styles.visibility !== 'hidden'
            && styles.opacity !== '0'
            && element.getClientRects().length > 0;
    }

    function getActiveModuleId() {
        return String(
            globalScope.document.querySelector('.sidebar-item.active[data-module]')?.dataset?.module
            || globalScope.document.querySelector('.module-container.active')?.id?.replace(/^module-/, '')
            || ''
        ).trim();
    }

    function toSafeText(value) {
        return String(value || '').trim();
    }

    function getProbeProfile() {
        if (probe.profile && typeof probe.profile === 'object') {
            return probe.profile;
        }
        const profiles = Array.isArray(probe.profiles) ? probe.profiles : [];
        return profiles[0] || {};
    }

    function firstArrayItem(value) {
        return Array.isArray(value) && value.length ? value[0] : null;
    }

    function pickFirstValue(...values) {
        for (const value of values) {
            const normalized = String(value || '').trim();
            if (normalized) {
                return normalized;
            }
        }
        return '';
    }

    function getPointsReadSite() {
        const site = String(globalScope.AdminSiteFilter?.getSiteFilter?.() || 'all').trim().toLowerCase();
        if (site === 'cn' || site === 'intl') {
            return site;
        }
        return 'all';
    }

    function getNonOpsChatSessions(instance = null) {
        const adminChat = instance || globalScope.adminChatInstance || null;
        if (!adminChat || !Array.isArray(adminChat.sessions)) {
            return [];
        }
        return adminChat.sessions.filter((session) => !adminChat.isOpsAlertSession?.(session));
    }

    function getSessionPriorityScore(session = {}) {
        let score = 0;
        if (session?.userId) score += 2;
        if (session?.ticketSummary?.openCount) score += 3;
        if (session?.paymentSummary?.id) score += 2;
        if (session?.verificationSummary?.verification_id) score += 2;
        if (Array.isArray(session?.sessionIds) && session.sessionIds.length > 1) score += 1;
        return score;
    }

    function isChatSessionLoaded(instance, selectedSessionId) {
        const normalizedSelectedSessionId = toSafeText(selectedSessionId);
        if (!instance || !normalizedSelectedSessionId) {
            return false;
        }

        const candidateIds = [
            instance.currentSessionKey,
            instance.currentSessionId,
            instance.currentSessionInfo?.sessionId,
            ...(Array.isArray(instance.currentSessionIds) ? instance.currentSessionIds : [])
        ].map((value) => toSafeText(value)).filter(Boolean);

        if (!candidateIds.includes(normalizedSelectedSessionId)) {
            return false;
        }

        const messagesArea = globalScope.document.getElementById('adminMessagesArea');
        if (!messagesArea) {
            return false;
        }

        return !messagesArea.querySelector('.chat-loading-state--skeleton');
    }

    async function resolveChatRuntimeSample() {
        markStep('resolve chat runtime sample');
        const instance = globalScope.adminChatInstance || null;
        if (!instance || typeof instance.loadSession !== 'function') {
            throw new Error('admin chat instance unavailable');
        }

        await waitFor(() => getNonOpsChatSessions(instance).length > 0, {
            timeoutMs: 20000,
            errorMessage: 'chat sessions did not load'
        });

        const sessions = getNonOpsChatSessions(instance)
            .sort((left, right) => getSessionPriorityScore(right) - getSessionPriorityScore(left));
        const requestedSessionId = pickFirstValue(probe.chatSessionId, probe.chat?.session_id);
        const selectedSession = sessions.find((session) => String(session?.sessionId || '').trim() === requestedSessionId)
            || sessions[0]
            || null;
        const selectedSessionId = String(selectedSession?.sessionId || requestedSessionId || '').trim();
        if (!selectedSessionId) {
            throw new Error('no usable chat session was found');
        }

        await runWithTimeout(() => instance.loadSession(selectedSessionId), 20000, 'chat session load timed out');
        await waitFor(() => isChatSessionLoaded(instance, selectedSessionId), {
            timeoutMs: 20000,
            errorMessage: 'chat session did not finish loading'
        });
        await waitFor(() => instance.currentUserContext && typeof instance.currentUserContext === 'object', {
            timeoutMs: 20000,
            errorMessage: 'chat user context did not load'
        });

        return {
            instance,
            session: instance.currentSessionInfo || selectedSession || null,
            context: instance.currentUserContext || {}
        };
    }

    function buildResolvedProbeContext(sample = null) {
        const runtimeContext = sample?.context || {};
        const runtimeSession = sample?.session || {};
        const runtimeOrders = Array.isArray(runtimeContext.orders) ? runtimeContext.orders : [];
        const runtimePayments = Array.isArray(runtimeContext.payments) ? runtimeContext.payments : [];
        const runtimeVerifications = Array.isArray(runtimeContext.verifications) ? runtimeContext.verifications : [];
        const runtimeTickets = Array.isArray(runtimeContext.tickets) ? runtimeContext.tickets : [];

        return {
            profile: getProbeProfile(),
            userId: pickFirstValue(
                probe.userId,
                probe.order?.user_id,
                probe.payment?.user_id,
                probe.ticket?.user_id,
                probe.chat?.user_id,
                runtimeContext.userId,
                runtimeSession.userId
            ),
            userEmail: pickFirstValue(
                probe.userEmail,
                probe.profile?.email,
                runtimeContext.email,
                runtimeSession.profile?.email,
                runtimeSession.email
            ),
            chatSessionId: pickFirstValue(
                probe.chatSessionId,
                probe.chat?.session_id,
                runtimeContext.sessionId,
                runtimeSession.sessionId,
                firstArrayItem(runtimeSession.sessionIds)
            ),
            orderId: pickFirstValue(
                probe.orderId,
                probe.order?.id,
                firstArrayItem(runtimeOrders)?.id,
                probe.ticket?.order_id,
                firstArrayItem(runtimeTickets)?.order_id
            ),
            paymentId: pickFirstValue(
                probe.paymentId,
                probe.payment?.id,
                firstArrayItem(runtimePayments)?.id
            ),
            verificationId: pickFirstValue(
                probe.verificationId,
                probe.verification?.verification_id,
                firstArrayItem(runtimeVerifications)?.verification_id
            ),
            ticketId: pickFirstValue(
                probe.ticketId,
                probe.ticket?.id,
                firstArrayItem(runtimeTickets)?.id
            )
        };
    }

    async function waitFor(test, options = {}) {
        const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 15000;
        const intervalMs = Number(options.intervalMs) > 0 ? Number(options.intervalMs) : 120;
        const errorMessage = String(options.errorMessage || 'Timed out').trim() || 'Timed out';
        const started = Date.now();

        while (Date.now() - started < timeoutMs) {
            try {
                const result = await test();
                if (result) return result;
            } catch (_) {
                // ignore transient probe errors
            }
            await new Promise((resolve) => globalScope.setTimeout(resolve, intervalMs));
        }

        throw new Error(errorMessage);
    }

    async function resolveWithTimeout(factory, timeoutMs = 5000, fallback = null) {
        try {
            return await Promise.race([
                Promise.resolve().then(factory),
                new Promise((resolve) => globalScope.setTimeout(() => resolve(fallback), timeoutMs))
            ]);
        } catch (_) {
            return fallback;
        }
    }

    async function runWithTimeout(factory, timeoutMs = 15000, errorMessage = 'Timed out') {
        const timeoutToken = {};
        const result = await Promise.race([
            Promise.resolve().then(factory),
            new Promise((resolve) => globalScope.setTimeout(() => resolve(timeoutToken), timeoutMs))
        ]);

        if (result === timeoutToken) {
            throw new Error(String(errorMessage || 'Timed out').trim() || 'Timed out');
        }

        return result;
    }

    async function settle(delayMs = 180) {
        await new Promise((resolve) => globalScope.requestAnimationFrame(() => globalScope.requestAnimationFrame(resolve)));
        if (delayMs > 0) {
            await new Promise((resolve) => globalScope.setTimeout(resolve, delayMs));
        }
    }

    async function fetchAdminJson(input) {
        const init = globalScope.AdminApi?.buildRequestInit
            ? await globalScope.AdminApi.buildRequestInit({ method: 'GET' })
            : { method: 'GET', credentials: 'include' };
        const response = await globalScope.fetch(input, init);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload?.message || `${input} failed (${response.status})`);
        }
        return payload || {};
    }

    async function ensureModule(moduleId, selector = '') {
        const opened = await runWithTimeout(() => Promise.resolve(globalScope.switchModule?.(moduleId, {
            silentDenied: true,
            fallback: false
        })), 15000, `switch module ${moduleId} timed out`);
        if (!opened) {
            return false;
        }
        await waitFor(() => {
            const moduleEl = globalScope.document.getElementById(`module-${moduleId}`);
            const markerEl = selector ? globalScope.document.querySelector(selector) : moduleEl;
            return isElementVisible(moduleEl) && (!selector || isElementVisible(markerEl));
        }, {
            errorMessage: `module ${moduleId} did not become visible`
        });
        await settle();
        return true;
    }

    function isModuleTargetActive(moduleId, selector = '') {
        const normalizedModuleId = toSafeText(moduleId);
        if (!normalizedModuleId) {
            return false;
        }

        const moduleEl = globalScope.document.getElementById(`module-${normalizedModuleId}`);
        if (!(moduleEl instanceof globalScope.HTMLElement) || moduleEl.hidden || !moduleEl.classList.contains('active')) {
            return false;
        }

        if (!selector) {
            return true;
        }

        const target = globalScope.document.querySelector(selector);
        if (!(target instanceof globalScope.HTMLElement)) {
            return false;
        }

        return !target.closest('.view-section:not(.active)');
    }

    function isSettingsViewTargetActive(viewName, selector = '') {
        const normalizedViewName = toSafeText(viewName);
        if (!normalizedViewName || !isModuleTargetActive('settings')) {
            return false;
        }

        const activeTab = globalScope.document.querySelector(`#module-settings [data-settings-view="${normalizedViewName}"].active`);
        const activeSection = globalScope.document.getElementById(`settings-view-${normalizedViewName}`);
        if (!(activeTab instanceof globalScope.HTMLElement) || !(activeSection instanceof globalScope.HTMLElement) || !activeSection.classList.contains('active')) {
            return false;
        }

        if (!selector) {
            return true;
        }

        const target = globalScope.document.querySelector(selector);
        return target instanceof globalScope.HTMLElement && !target.closest('.view-section:not(.active)');
    }

    function isUserModalTabActive(tabName = '') {
        const normalizedTabName = toSafeText(tabName);
        if (!normalizedTabName) {
            return false;
        }

        const overlay = globalScope.document.getElementById('userModalOverlay');
        if (!(overlay instanceof globalScope.HTMLElement) || !overlay.classList.contains('active')) {
            return false;
        }

        const activeTab = globalScope.document.querySelector(`#userTabNav [data-user-tab="${normalizedTabName}"].active`);
        return activeTab instanceof globalScope.HTMLElement;
    }

    async function ensureShopTab(tabId, selector) {
        await globalScope.ShopAdmin?.init?.();
        await runWithTimeout(() => Promise.resolve(globalScope.ShopAdmin?.switchTab?.(tabId)), 15000, `switch shop tab ${tabId} timed out`);
        await waitFor(() => {
            const view = globalScope.document.getElementById(`shop-view-${tabId}`);
            const marker = selector ? globalScope.document.querySelector(selector) : view;
            return isElementVisible(view) && (!selector || isElementVisible(marker));
        }, {
            errorMessage: `shop tab ${tabId} did not become visible`
        });
        await settle();
        return true;
    }

    async function ensurePointsView(viewId, selector) {
        const trigger = globalScope.document.querySelector(`#module-points [data-admin-action="points-switch-view"][data-points-view-target="${viewId}"]`);
        if (trigger instanceof globalScope.HTMLElement) {
            trigger.click();
        }
        await waitFor(() => {
            const view = globalScope.document.getElementById(`points-view-${viewId}`);
            const marker = selector ? globalScope.document.querySelector(selector) : view;
            return isElementVisible(view) && (!selector || isElementVisible(marker));
        }, {
            errorMessage: `points view ${viewId} did not become visible`
        });
        await settle();
        return true;
    }

    async function resolvePointsLookupProbe() {
        const site = getPointsReadSite();
        const batchRows = Array.from(
            globalScope.document.querySelectorAll('#batchesTableBody tr[data-batch-id]')
        ).slice(0, 5);

        for (const row of batchRows) {
            const batchId = toSafeText(row?.dataset?.batchId);
            if (!batchId) {
                continue;
            }

            try {
                const payload = await fetchAdminJson(`/api/admin/points/batches?site=${encodeURIComponent(site)}&batchId=${encodeURIComponent(batchId)}`);
                const codes = Array.isArray(payload?.codes) ? payload.codes : [];
                const matchedCode = codes.find((item) => toSafeText(item?.code));
                if (matchedCode?.code) {
                    return {
                        batchId,
                        code: toSafeText(matchedCode.code)
                    };
                }
            } catch (error) {
                captureError('pointsLookupProbe', error);
            }
        }

        return null;
    }

    async function validatePointsLookupFlow() {
        record(await ensurePointsView('lookup', '#lookupCodeInput'), 'points lookup view');

        const probeEntry = await resolvePointsLookupProbe();
        if (!probeEntry?.code) {
            record(false, 'points lookup query', 'no redeem code probe available');
            return;
        }

        const input = globalScope.document.getElementById('lookupCodeInput');
        if (input instanceof globalScope.HTMLInputElement) {
            input.value = probeEntry.code;
            input.dispatchEvent(new globalScope.Event('input', { bubbles: true }));
            input.dispatchEvent(new globalScope.Event('change', { bubbles: true }));
        }

        const trigger = globalScope.document.querySelector('#module-points [data-admin-action="points-lookup-code"]');
        if (trigger instanceof globalScope.HTMLElement) {
            trigger.click();
        } else {
            await Promise.resolve(globalScope.lookupCode?.());
        }

        await waitFor(() => {
            const result = globalScope.document.getElementById('lookupResult');
            const status = result?.querySelector('.lookup-status');
            return isElementVisible(result) && Boolean(toSafeText(status?.textContent));
        }, {
            timeoutMs: 20000,
            errorMessage: 'points lookup result did not render'
        });

        const resultText = toSafeText(globalScope.document.getElementById('lookupResult')?.textContent);
        const failed = /查询失败|未找到/.test(resultText);
        const statusText = toSafeText(globalScope.document.querySelector('#lookupResult .lookup-status')?.textContent);
        record(!failed, 'points lookup query', `${probeEntry.code}${statusText ? ` · ${statusText}` : ''}`);
    }

    function getAccessibleModules() {
        return [
            'gallery',
            'comments',
            'chat',
            'shop',
            'discounts',
            'homepage',
            'users',
            'points',
            'tickets',
            'payments',
            'ops-alerts',
            'settings'
        ].filter((moduleId) => globalScope.hasModulePermission?.(moduleId) === true);
    }

    function getDeniedModules() {
        return [
            'gallery',
            'comments',
            'chat',
            'shop',
            'discounts',
            'homepage',
            'users',
            'points',
            'tickets',
            'payments',
            'ops-alerts',
            'settings'
        ].filter((moduleId) => globalScope.hasModulePermission?.(moduleId) === false);
    }

    async function validateSuperModules() {
        markStep('validate super modules: gallery');
        record(await ensureModule('gallery', '#module-gallery'), 'gallery module');
        markStep('validate super modules: comments');
        record(await ensureModule('comments', '#adminCommentList'), 'comments module');

        await globalScope.switchCommentView?.('guestbook');
        await waitFor(() => globalScope.document.querySelector('#module-comments [data-comment-view="guestbook"].active'));
        record(true, 'comments guestbook tab');

        await globalScope.switchCommentView?.('gallery');
        await waitFor(() => globalScope.document.querySelector('#module-comments [data-comment-view="gallery"].active'));
        record(true, 'comments gallery tab');

        markStep('validate super modules: shop');
        record(await ensureModule('shop', '#module-shop'), 'shop module');
        record(await ensureShopTab('products', '#shop-view-products'), 'shop products tab');
        record(await ensureShopTab('orders', '#orderSearchInput'), 'shop orders tab');
        record(await ensureShopTab('fulfillment', '#deliveryTasksTableBody'), 'shop fulfillment tab');

        markStep('validate super modules: discounts');
        record(await ensureModule('discounts', '#discountSearchInput'), 'discounts module');
        markStep('validate super modules: users');
        record(await ensureModule('users', '#usersTableBody'), 'users module');
        markStep('validate super modules: points');
        record(await ensureModule('points', '#points-view-batches'), 'points module');
        record(await ensurePointsView('batches', '#points-view-batches .users-table-panel'), 'points batches view');
        const batchesPayload = await fetchAdminJson(`/api/admin/points/batches?site=${encodeURIComponent(getPointsReadSite())}`);
        record(Array.isArray(batchesPayload?.batches), 'points batches data', `count=${Array.isArray(batchesPayload?.batches) ? batchesPayload.batches.length : 0}`);
        record(await ensurePointsView('catalog', '#points-view-catalog .points-catalog-panel'), 'points catalog view');
        const catalogPayload = await fetchAdminJson(`/api/admin/points/catalog?site=${encodeURIComponent(getPointsReadSite())}`);
        record(Array.isArray(catalogPayload?.packages), 'points catalog data', `count=${Array.isArray(catalogPayload?.packages) ? catalogPayload.packages.length : 0}`);
        await validatePointsLookupFlow();

        markStep('validate super modules: homepage');
        record(await ensureModule('homepage', '#module-homepage'), 'homepage module');
        await Promise.resolve(globalScope.HomepageAdmin?.switchSection?.('guestbook'));
        await waitFor(() => globalScope.document.querySelector('[data-hp-view="guestbook"].active') || isElementVisible(globalScope.document.getElementById('hp-guestbook-title')));
        record(true, 'homepage guestbook section');

        markStep('validate super modules: tickets');
        record(await ensureModule('tickets', '#ticketsTableBody'), 'tickets module');
        markStep('validate super modules: admin chat');
        await runWithTimeout(() => Promise.resolve(globalScope.switchModule?.('chat', {
            silentDenied: true,
            fallback: false
        })), 15000, 'switch module chat timed out');
        await waitFor(() => isModuleTargetActive('chat'), {
            errorMessage: 'module chat did not become active'
        });
        await settle();
        record(true, 'admin chat module');
    }

    async function validateWorkbenchEntries(sample = null) {
        markStep('validate workbench: verify monitor');
        const resolved = buildResolvedProbeContext(sample);
        const contextUserId = toSafeText(resolved.userId || resolved.profile?.id);
        const contextEmail = toSafeText(resolved.userEmail || resolved.profile?.email);

        const verifyOpened = await runWithTimeout(() => globalScope.openAdminWorkbenchEntry?.('verify-monitor', {}), 20000, 'open verify workbench timed out');
        await waitFor(() => isSettingsViewTargetActive('content', '#verifyMonitorPanel'), {
            errorMessage: 'verify workbench target did not open'
        });
        record(Boolean(verifyOpened), 'workbench verify monitor');

        markStep('validate workbench: payments overview');
        const paymentsOpened = await runWithTimeout(() => globalScope.openAdminWorkbenchEntry?.('payments-overview', {
            paymentOrderId: toSafeText(resolved.paymentId)
        }), 20000, 'open payments workbench timed out');
        await waitFor(() => isModuleTargetActive('payments', '#paymentsProviderStats'), {
            errorMessage: 'payments workbench target did not open'
        });
        record(Boolean(paymentsOpened), 'workbench payments overview');

        markStep('validate workbench: shop order');
        const orderOpened = await runWithTimeout(() => globalScope.openAdminWorkbenchEntry?.('shop-risk-orders', {
            orderId: toSafeText(resolved.orderId),
            referenceLabel: '订单',
            referenceValue: toSafeText(resolved.orderId)
        }), 20000, 'open shop order workbench timed out');
        await waitFor(() => isModuleTargetActive('shop', '#orderSearchInput') && (globalScope.ShopAdmin?.currentTab === 'orders' || globalScope.document.getElementById('shop-view-orders')?.classList.contains('active') === true), {
            errorMessage: 'shop order workbench target did not open'
        });
        record(Boolean(orderOpened), 'workbench shop order');

        markStep('validate workbench: pending ticket');
        const ticketId = toSafeText(resolved.ticketId);
        const ticketOpened = await runWithTimeout(() => globalScope.openAdminWorkbenchEntry?.('tickets-pending', {
            ticketId,
            ticketStatus: 'pending',
            referenceLabel: '工单号',
            referenceValue: ticketId
        }), 20000, 'open tickets workbench timed out');
        await waitFor(() => isModuleTargetActive('tickets', '#ticketsTableBody'), {
            errorMessage: 'tickets workbench target did not open'
        });
        record(Boolean(ticketOpened), 'workbench pending ticket');
        if (ticketId && globalScope.AdminTickets?.openReplyModal) {
            globalScope.AdminTickets.openReplyModal(ticketId, 'RESOLVED');
            await waitFor(() => globalScope.document.getElementById('ticketReplyModal')?.classList.contains('is-visible') === true, {
                errorMessage: 'ticket reply modal did not open'
            });
            record(true, 'ticket process modal');
            globalScope.AdminTickets.closeReplyModal?.();
        }

        markStep('validate workbench: user detail');
        const userOpened = await runWithTimeout(() => globalScope.openAdminWorkbenchEntry?.('shop-risk-users', {
            userId: contextUserId,
            email: contextEmail
        }), 20000, 'open user workbench timed out');
        await waitFor(() => {
            const overlay = globalScope.document.getElementById('userModalOverlay');
            return overlay?.classList.contains('active') === true || isElementVisible(globalScope.document.getElementById('module-users'));
        }, {
            errorMessage: 'user workbench target did not open'
        });
        record(Boolean(userOpened), 'workbench user detail');
    }

    async function validateChatSessionActions(sample = null) {
        markStep('validate chat actions');
        const instance = sample?.instance || globalScope.adminChatInstance || null;
        const chatSessionId = toSafeText(sample?.context?.sessionId || sample?.session?.sessionId || probe.chatSessionId || probe.chat?.session_id);
        if (!instance || !chatSessionId) {
            record(false, 'chat action chain', 'missing session or admin chat instance');
            return;
        }
        record(true, 'chat session loaded', chatSessionId);

        const actions = instance.getUserContextQuickActions(instance.currentUserContext || {});
        const actionMap = new Map(
            (Array.isArray(actions) ? actions : [])
                .map((item) => [toSafeText(item.key || item.action).toLowerCase(), item])
                .filter((entry) => entry[0])
        );

        if (actionMap.has('user')) {
            markStep('validate chat action: user');
            const opened = await runWithTimeout(() => instance.handleUserContextAction(actionMap.get('user')), 20000, 'chat quick action user timed out');
            await waitFor(() => globalScope.document.getElementById('userModalOverlay')?.classList.contains('active') === true || isModuleTargetActive('users'), {
                errorMessage: 'chat quick action user did not open target'
            });
            record(Boolean(opened), 'chat quick action user');
        }

        if (actionMap.has('payment')) {
            markStep('validate chat action: payment');
            const opened = await runWithTimeout(() => instance.handleUserContextAction(actionMap.get('payment')), 20000, 'chat quick action payment timed out');
            await waitFor(() => isModuleTargetActive('payments', '#paymentsProviderStats') || isUserModalTabActive('payments'), {
                errorMessage: 'chat quick action payment did not open target'
            });
            record(Boolean(opened), 'chat quick action payment', isUserModalTabActive('payments') ? 'user modal payments' : 'payments module');
        }

        if (actionMap.has('order')) {
            markStep('validate chat action: order');
            const opened = await runWithTimeout(() => instance.handleUserContextAction(actionMap.get('order')), 20000, 'chat quick action order timed out');
            await waitFor(() => isModuleTargetActive('shop', '#orderSearchInput') && (globalScope.ShopAdmin?.currentTab === 'orders' || globalScope.document.getElementById('shop-view-orders')?.classList.contains('active') === true), {
                errorMessage: 'chat quick action order did not open target'
            });
            record(Boolean(opened), 'chat quick action order');
        }

        if (actionMap.has('ticket')) {
            markStep('validate chat action: ticket');
            const opened = await runWithTimeout(() => instance.handleUserContextAction(actionMap.get('ticket')), 20000, 'chat quick action ticket timed out');
            await waitFor(() => isModuleTargetActive('tickets', '#ticketsTableBody'), {
                errorMessage: 'chat quick action ticket did not open target'
            });
            record(Boolean(opened), 'chat quick action ticket');
        }

        if (actionMap.has('verify')) {
            markStep('validate chat action: verify');
            const opened = await runWithTimeout(() => instance.handleUserContextAction(actionMap.get('verify')), 20000, 'chat quick action verify timed out');
            await waitFor(() => isSettingsViewTargetActive('content', '#verifyMonitorPanel'), {
                errorMessage: 'chat quick action verify did not open target'
            });
            record(Boolean(opened), 'chat quick action verify');
        }

        markStep('validate chat action: create ticket visibility');
        if (actionMap.has('create_ticket')) {
            record(true, 'chat quick action create_ticket visible', 'mutation skipped in read-only real smoke');
        } else {
            record(true, 'chat quick action create_ticket hidden', 'existing ticket or context gating');
        }
    }

    async function validateLimitedPermissions(access) {
        const deniedModules = getDeniedModules();
        const accessibleModules = getAccessibleModules();
        record(deniedModules.length > 0, 'limited admin has denied modules', deniedModules.join(',') || 'none');
        record(accessibleModules.length > 0, 'limited admin has accessible modules', accessibleModules.join(',') || 'none');

        deniedModules.slice(0, 4).forEach((moduleId) => {
            const sidebarItem = globalScope.document.querySelector(`.sidebar-item[data-module="${moduleId}"]`);
            const hidden = !isElementVisible(sidebarItem);
            const disabled = sidebarItem?.classList?.contains('disabled') === true || sidebarItem?.getAttribute?.('aria-disabled') === 'true';
            const gated = hidden || disabled;
            record(gated, `limited sidebar gated ${moduleId}`, hidden ? 'hidden' : (disabled ? 'disabled' : 'visible'));
        });

        const beforeModule = getActiveModuleId();
        const deniedTarget = deniedModules[0];
        if (deniedTarget) {
            const switched = await Promise.resolve(globalScope.switchModule?.(deniedTarget, {
                silentDenied: true,
                fallback: false
            }));
            record(switched === false, `limited switch denied ${deniedTarget}`, getActiveModuleId() || beforeModule);
        }

        const allowUsers = accessibleModules.includes('users');
        if (allowUsers) {
            const userOpened = await globalScope.openAdminWorkbenchEntry?.('shop-risk-users', {
                userId: toSafeText(probe.userId || probe.profile?.id || 'limited-admin-readonly-user'),
                email: toSafeText(probe.userEmail || probe.profile?.email)
            });
            await waitFor(() => {
                const overlay = globalScope.document.getElementById('userModalOverlay');
                return overlay?.classList.contains('active') === true || isElementVisible(globalScope.document.getElementById('module-users'));
            }, {
                errorMessage: 'limited user workbench did not open'
            });
            record(Boolean(userOpened), 'limited workbench allowed user detail');
        }

        const allowTickets = accessibleModules.includes('tickets');
        if (allowTickets) {
            const ticketsOpened = await globalScope.openAdminWorkbenchEntry?.('tickets-pending', {
                ticketId: toSafeText(probe.ticketId || probe.ticket?.id)
            });
            await waitFor(() => isElementVisible(globalScope.document.getElementById('ticketsTableBody')), {
                errorMessage: 'limited tickets module did not open'
            });
            record(Boolean(ticketsOpened), 'limited workbench allowed tickets');
        }

        const deniedWorkbench = await globalScope.openAdminWorkbenchEntry?.('payments-overview', {
            paymentOrderId: toSafeText(probe.paymentId || probe.payment?.id)
        });
        record(deniedWorkbench === false, 'limited workbench denied payments');
    }

    async function run() {
        markStep('bootstrap');
        render();
        await Promise.resolve(globalScope.__adminStudioSessionRestoreReady).catch((error) => {
            captureError('sessionRestore', error);
        });
        const supabaseStorageKeys = Object.keys(globalScope.localStorage || {})
            .filter((key) => String(key || '').startsWith('sb-') && String(key || '').endsWith('-auth-token'));
        record(supabaseStorageKeys.length > 0, 'supabase storage seed', supabaseStorageKeys.join(',') || 'none');

        const authSessionResult = await resolveWithTimeout(() => globalScope.supabaseClient?.auth?.getSession?.(), 5000, null);
        const browserSession = authSessionResult?.data?.session || null;

        const authUserResult = await resolveWithTimeout(() => globalScope.supabaseClient?.auth?.getUser?.(), 5000, null);
        const browserUser = authUserResult?.data?.user || null;

        const accessProbe = await resolveWithTimeout(() => globalScope.AdminAccess?.getCurrentAdminAccess?.({ forceRefresh: true }), 8000, null);
        const authFallbackAvailable = supabaseStorageKeys.length > 0 && Boolean(accessProbe?.user?.id);
        record(Boolean(browserSession?.access_token) || authFallbackAvailable, 'browser auth session', browserSession?.user?.email || browserSession?.user?.id || (authFallbackAvailable ? 'persisted fallback' : ''));
        record(Boolean(browserUser?.id) || authFallbackAvailable, 'browser auth user', browserUser?.email || browserUser?.id || (authFallbackAvailable ? 'persisted fallback' : ''));
        if (accessProbe) {
            record(Boolean(accessProbe?.user), 'admin access user probe', toSafeText(accessProbe?.user?.email || accessProbe?.user?.id || accessProbe?.error?.message));
            record(Boolean(accessProbe?.isAdmin), 'admin access admin probe', accessProbe?.error?.message || '');
        } else {
            record(false, 'admin access probe', 'timed out');
        }

        await waitFor(() => globalScope.adminStudioAccessGranted === true && typeof globalScope.switchModule === 'function' && globalScope.AdminAccess?.getCurrentAdminAccess, {
            timeoutMs: 25000,
            errorMessage: 'admin studio access was not granted'
        });

        const access = await globalScope.AdminAccess.getCurrentAdminAccess({ forceRefresh: true });
        record(Boolean(access?.isAdmin), 'admin access', toSafeText(access?.user?.email || access?.user?.id));
        record(expectedRole === 'limited' ? access?.isSuperAdmin !== true : access?.isSuperAdmin === true, 'role expectation', expectedRole);

        if (expectedRole === 'limited') {
            markStep('validate limited permissions');
            await validateLimitedPermissions(access || {});
        } else {
            await validateSuperModules();
            const runtimeSample = await resolveChatRuntimeSample();
            await validateWorkbenchEntries(runtimeSample);
            await validateChatSessionActions(runtimeSample);
        }

        markStep('completed');
        state.completed = true;
        render();
    }

    function startRealSmoke() {
        globalScope.setTimeout(() => {
            run().catch((error) => {
                state.completed = true;
                captureError('realSmoke', error);
                record(false, 'real smoke execution', error?.message || String(error));
            });
        }, 120);
    }

    if (globalScope.document.readyState === 'loading') {
        globalScope.document.addEventListener('DOMContentLoaded', startRealSmoke, { once: true });
    } else {
        startRealSmoke();
    }
})(typeof window !== 'undefined' ? window : globalThis);
