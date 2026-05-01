(function () {
    'use strict';

    if (window.AdminCommandCenter?.version) {
        return;
    }

    const STORAGE_KEY = 'zaoyoe_admin_command_center_collapsed';
    const VERSION = '20260428_ADMIN_PULSE_DOCK_SWITCH_STEADY_1';
    const PANEL_OPEN_ANIMATION_MS = 260;
    const PANEL_CLOSE_ANIMATION_MS = 220;
    const COMMAND_CENTER_IMMEDIATE_PRIME_KEYS = Object.freeze(['notifications', 'inventory']);
    const COMMAND_CENTER_DEFERRED_PRIME_STAGES = Object.freeze([
        { key: 'payments', delayMs: 650 },
        { key: 'ai', delayMs: 1300 },
        { key: 'security', delayMs: 2100 }
    ]);
    const MODULE_LABELS = Object.freeze({
        gallery: 'Gallery',
        comments: '评论',
        chat: '客服',
        shop: '商城',
        discounts: '券码',
        homepage: '主页',
        users: '用户',
        points: '兑换',
        tickets: '工单',
        analytics: '经营',
        'growth-center': '增长',
        'commerce-center': '商品',
        payments: '支付',
        'ops-alerts': '告警',
        'ops-workspace': '工作位',
        settings: '设置'
    });
    const QUICK_ACTIONS = Object.freeze([
        {
            moduleId: 'growth-center',
            label: '增长经营',
            icon: 'fas fa-chart-area'
        },
        {
            moduleId: 'commerce-center',
            label: '商品经营',
            icon: 'fas fa-box-open'
        },
        {
            moduleId: 'ops-alerts',
            label: '站外告警',
            icon: 'fas fa-bell'
        },
        {
            moduleId: 'settings',
            label: '安全设置',
            icon: 'fas fa-shield-alt',
            context: {
                action: 'security',
                payload: {
                    defaultTab: 'security'
                }
            }
        }
    ]);
    const QUICK_ACTION_HELPERS = Object.freeze({
        homepage: {
            helperName: 'openAdminHomepageShellContext',
            options: { viewName: 'overview' }
        },
        gallery: {
            helperName: 'openAdminGalleryShellContext'
        },
        comments: {
            helperName: 'openAdminCommentsShellContext'
        },
        users: {
            helperName: 'openAdminUsersShellContext',
            options: { silentOnNotFound: true }
        },
        points: {
            helperName: 'openAdminPointsShellContext'
        },
        payments: {
            helperName: 'openAdminPaymentsShellContext',
            context: { payload: { defaultTab: 'overview' } }
        },
        shop: {
            helperName: 'openAdminShopShellContext',
            context: { payload: { workspace: 'products' } }
        },
        tickets: {
            helperName: 'openAdminTicketsShellContext',
            context: { payload: { workspace: 'queue' } }
        },
        discounts: {
            helperName: 'openAdminDiscountsShellContext'
        },
        'growth-center': {
            helperName: 'openAdminGrowthCenterShellContext',
            context: { payload: { view: 'growth' } },
            options: { viewName: 'growth' }
        },
        'commerce-center': {
            helperName: 'openAdminGrowthCenterShellContext',
            context: { payload: { view: 'product' } },
            options: { viewName: 'product' }
        }
    });

    const state = {
        activeModuleId: '',
        site: 'all',
        aiService: '',
        aiStatus: '待检测',
        aiBudget: null,
        lastLatencyMs: 0,
        securityStatus: '权限守卫已开启',
        lastSignal: 'Ready',
        contextTrail: [],
        feedbackSignals: [],
        feedbackSeed: 0,
        notificationsSummary: createDefaultNotificationsSummary(),
        paymentsSummary: createDefaultPaymentsSummary(),
        inventorySummary: createDefaultInventorySummary(),
        aiSummary: createDefaultAISummary(),
        securitySummary: createDefaultSecuritySummary(),
        quickActionState: {
            key: '',
            moduleId: '',
            state: 'ready'
        },
        activePulseId: 'overview',
        panelOpen: false,
        panelPhase: 'closed',
        panelMotion: createDefaultPanelMotion(),
        panelPhaseTimerId: 0,
        panelPhaseToken: 0,
        pulsePrimeTimerIds: [],
        pulsePrimeToken: 0,
        actionToast: '选择一个待处理入口，直接回到对应页面处理。',
        collapsed: false,
        dockPointer: {
            active: false,
            clientX: 0,
            clientY: 0
        },
        dockLiftByPulseId: {},
        initializedAt: Date.now()
    };

    const FEEDBACK_STATE_LABELS = Object.freeze({
        ready: 'Ready',
        loading: 'Loading',
        saved: 'Saved',
        partial: 'Partial',
        failed: 'Failed'
    });
    const FEEDBACK_SOURCE_LABELS = Object.freeze({
        'studio-header': '顶部状态',
        'command-center': '指挥台',
        toast: '操作回执',
        'admin-studio': '后台反馈',
        'payments-focus': '支付定位',
        'payments-ops': '支付处理',
        'payments-batch': '支付批量',
        'shop-focus': '商城定位',
        'shop-orders': '订单处理',
        'shop-products': '商品处理',
        'shop-inventory': '库存处理',
        'shop-fulfillment': '履约处理',
        'tickets-focus': '工单定位',
        'tickets-process': '工单处理',
        'tickets-batch': '工单批量',
        'discounts-generate': '券码生成',
        'discounts-restore': '券码恢复',
        'discounts-batch': '券码批量',
        'discounts-retry': '券码重试',
        'users-batch': '用户批量',
        'users-notification': '用户通知',
        'users-points': '用户积分',
        'users-access': '权限处理',
        'users-ban': '封禁处理',
        'users-profile': '用户资料',
        'users-coupons': '用户卡券',
        'users-danger': '危险清理',
        'users-export': '用户导出',
        'settings-config': '设置配置',
        'settings-security': '安全设置',
        'settings-announcement': '公告设置',
        'settings-payment': '支付设置',
        'settings-verify': '验证设置',
        'ops-alerts-settings': '告警配置',
        'ops-alerts-case': '告警处置',
        'ops-alerts-mute': '告警静默',
        'ops-alerts-report': '告警报表',
        'homepage-prompts': '首页精选',
        'homepage-draft': '首页草稿',
        'homepage-release': '首页发布',
        'homepage-template': '首页模板',
        'homepage-schedule': '定时发布',
        'homepage-experiment': '首页实验',
        'homepage-recommendation': '首页建议',
        'homepage-theme-pack': '主题包',
        'homepage-report': '首页报表',
        'points-generate': '兑换码生成',
        'points-packages': '积分套餐',
        'points-batch': '积分批次',
        'points-codes': '兑换码处理',
        'comments-batch': '评论批量',
        'comments-governance': '评论治理'
    });
    const CONTEXT_ACTION_LABELS = Object.freeze({
        'open-prompt-analytics': '内容经营分析',
        'open-prompt-gallery': '打开 Prompt Gallery',
        'open-prompt-homepage': '主页 Prompt',
        'open-comment-context': '评论上下文',
        'open-user-context': '用户详情',
        'open-ticket-context': '工单详情',
        'open-order-detail': '订单详情',
        'focus-exception-topic': '异常专题',
        'focus-priority-action': '优先动作'
    });
    const CONTEXT_DELIVERY_LABELS = Object.freeze({
        delivered: '已送达',
        unhandled: '待接管',
        failed: '送达失败'
    });

    function sanitizeText(value, maxLength = 180) {
        return String(value || '').trim().slice(0, Math.max(0, maxLength));
    }

    function escapeHtml(value) {
        return sanitizeText(value, 600)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function normalizeModuleId(value = '') {
        return sanitizeText(value, 120).toLowerCase();
    }

    function normalizeActionStateKey(value = '') {
        return sanitizeText(value, 120).toLowerCase();
    }

    function normalizeCount(value = 0) {
        return Math.max(0, Number(value || 0) || 0);
    }

    function normalizeTimestamp(value = 0) {
        if (Number.isFinite(Number(value)) && Number(value) > 0) {
            return Number(value);
        }
        const parsed = Date.parse(String(value || '').trim());
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    }

    function normalizeTimelineTone(value = '') {
        const normalized = sanitizeText(value, 40).toLowerCase();
        if (['alert', 'danger', 'critical', 'error', 'failed'].includes(normalized)) {
            return 'alert';
        }
        if (['warn', 'warning', 'partial', 'loading'].includes(normalized)) {
            return 'warn';
        }
        if (['ok', 'success', 'saved', 'ready'].includes(normalized)) {
            return 'ok';
        }
        return '';
    }

    function normalizeDataObject(value = {}) {
        return value && typeof value === 'object' && !Array.isArray(value)
            ? { ...value }
            : {};
    }

    function clampNumber(value, min, max) {
        return Math.min(max, Math.max(min, Number(value) || 0));
    }

    function createDefaultPanelMotion() {
        return {
            shiftX: 36,
            shiftY: 0,
            scale: 0.78,
            originX: '100%',
            originY: '50%'
        };
    }

    function getPanelMotionStyle(motion = {}) {
        const normalized = {
            ...createDefaultPanelMotion(),
            ...(motion && typeof motion === 'object' ? motion : {})
        };
        return [
            `--admin-command-panel-shift-x:${Math.round(normalized.shiftX)}px`,
            `--admin-command-panel-shift-y:${Math.round(normalized.shiftY)}px`,
            `--admin-command-panel-start-scale:${clampNumber(normalized.scale, 0.6, 0.96).toFixed(2)}`,
            `--admin-command-panel-origin-x:${sanitizeText(normalized.originX, 20) || '100%'}`,
            `--admin-command-panel-origin-y:${sanitizeText(normalized.originY, 20) || '50%'}`
        ].join(';');
    }

    function scheduleCommandCenterTask(callback, delay = 0) {
        const scheduler = typeof window.setTimeout === 'function'
            ? window.setTimeout.bind(window)
            : (typeof setTimeout === 'function' ? setTimeout : null);
        if (typeof scheduler !== 'function') {
            callback();
            return 0;
        }
        return scheduler(callback, delay);
    }

    function cancelCommandCenterTask(taskId) {
        const canceller = typeof window.clearTimeout === 'function'
            ? window.clearTimeout.bind(window)
            : (typeof clearTimeout === 'function' ? clearTimeout : null);
        if (typeof canceller === 'function' && taskId) {
            canceller(taskId);
        }
    }

    function normalizeRecentItems(items = []) {
        return (Array.isArray(items) ? items : []).map((item) => {
            const raw = item && typeof item === 'object' && !Array.isArray(item) ? item : {};
            const label = sanitizeText(raw.label || raw.title || raw.name, 80);
            const copy = sanitizeText(raw.copy || raw.detail || raw.message || raw.summary, 180);
            if (!label || !copy) {
                return null;
            }
            return {
                label,
                copy,
                timestamp: normalizeTimestamp(raw.timestamp || raw.at || raw.createdAt || raw.created_at || raw.updatedAt || raw.updated_at),
                timeLabel: sanitizeText(raw.timeLabel || raw.ageLabel || raw.time, 40),
                tone: normalizeTimelineTone(raw.tone || raw.level || raw.status),
                moduleId: normalizeModuleId(raw.moduleId || raw.module || raw.module_id),
                stateKey: normalizeActionStateKey(raw.stateKey || raw.state_key),
                feedbackLabel: sanitizeText(raw.feedbackLabel || raw.feedback_label || label, 80),
                intent: sanitizeText(raw.intent || raw.actionLabel || raw.action_label, 180),
                context: normalizeDataObject(raw.context),
                options: normalizeDataObject(raw.options)
            };
        }).filter(Boolean).slice(0, 6);
    }

    function createDefaultNotificationsSummary() {
        return {
            ready: false,
            status: 'idle',
            unreadMessages: 0,
            pendingReply: 0,
            staleReply: 0,
            openTickets: 0,
            verificationAlerts: 0,
            paymentFollowups: 0,
            systemAlerts: 0,
            unreadSystemAlerts: 0,
            actionableCount: 0,
            recentItems: []
        };
    }

    function createDefaultPaymentsSummary() {
        return {
            ready: false,
            status: 'idle',
            paidRate: null,
            retryCount: 0,
            pendingCount: 0,
            processingCount: 0,
            deadLetterCount: 0,
            actionableOpsCount: 0,
            reviewOrders: 0,
            failedOrders: 0,
            actionableCount: 0,
            recentItems: []
        };
    }

    function createDefaultInventorySummary() {
        return {
            ready: false,
            status: 'idle',
            lowStockCount: 0,
            soldOutCount: 0,
            deliveryRiskProductCount: 0,
            purchaseConversionRate: null,
            orderCount: 0,
            activeProducts: 0,
            actionableCount: 0,
            lastMessage: '',
            recentItems: []
        };
    }

    function createDefaultAISummary() {
        return {
            ready: false,
            status: 'idle',
            configured: false,
            service: '',
            serviceLabel: '',
            model: '',
            source: '',
            budgetTier: '',
            estimatedInputTokens: 0,
            maxOutputTokens: 0,
            truncated: false,
            truncatedChars: 0,
            lastLatencyMs: 0,
            lastOutputChars: 0,
            lastResponseOk: null,
            lastMessage: '',
            actionableCount: 0,
            recentItems: []
        };
    }

    function createDefaultSecuritySummary() {
        return {
            ready: false,
            status: 'idle',
            accessCount: 0,
            anomalyCount: 0,
            configChangeCount: 0,
            secretDeleteCount: 0,
            mockSwitchCount: 0,
            distinctAdminCount: 0,
            distinctIpCount: 0,
            activeProblemCount: 0,
            actionableCount: 0,
            recentItems: []
        };
    }

    function normalizeNotificationsSummary(summary = {}) {
        const raw = summary && typeof summary === 'object' && !Array.isArray(summary)
            ? summary
            : {};
        const pendingReply = normalizeCount(raw.pendingReply);
        const systemAlerts = normalizeCount(raw.systemAlerts);
        const actionableCount = raw.actionableCount != null
            ? normalizeCount(raw.actionableCount)
            : null;
        const unreadSystemAlerts = raw.unreadSystemAlerts != null
            ? normalizeCount(raw.unreadSystemAlerts)
            : Math.max(0, (actionableCount != null ? actionableCount - pendingReply : systemAlerts));
        return {
            ...createDefaultNotificationsSummary(),
            ready: raw.ready === true,
            status: sanitizeText(raw.status, 40).toLowerCase() || (raw.ready === true ? 'ready' : 'idle'),
            unreadMessages: normalizeCount(raw.unreadMessages),
            pendingReply,
            staleReply: normalizeCount(raw.staleReply),
            openTickets: normalizeCount(raw.openTickets),
            verificationAlerts: normalizeCount(raw.verificationAlerts),
            paymentFollowups: normalizeCount(raw.paymentFollowups),
            systemAlerts,
            unreadSystemAlerts,
            recentItems: normalizeRecentItems(raw.recentItems),
            actionableCount: actionableCount != null
                ? actionableCount
                : pendingReply + unreadSystemAlerts
        };
    }

    function normalizePaymentsSummary(summary = {}) {
        const raw = summary && typeof summary === 'object' && !Array.isArray(summary)
            ? summary
            : {};
        const retryCount = normalizeCount(raw.retryCount);
        const pendingCount = normalizeCount(raw.pendingCount);
        const processingCount = normalizeCount(raw.processingCount);
        const deadLetterCount = normalizeCount(raw.deadLetterCount);
        const actionableOpsCount = raw.actionableOpsCount != null
            ? normalizeCount(raw.actionableOpsCount)
            : retryCount + pendingCount + processingCount + deadLetterCount;
        const reviewOrders = normalizeCount(raw.reviewOrders);
        const failedOrders = normalizeCount(raw.failedOrders);
        return {
            ...createDefaultPaymentsSummary(),
            ready: raw.ready === true,
            status: sanitizeText(raw.status, 40).toLowerCase() || (raw.ready === true ? 'ready' : 'idle'),
            paidRate: Number.isFinite(Number(raw.paidRate)) ? Number(raw.paidRate) : null,
            retryCount,
            pendingCount,
            processingCount,
            deadLetterCount,
            actionableOpsCount,
            reviewOrders,
            failedOrders,
            recentItems: normalizeRecentItems(raw.recentItems),
            actionableCount: raw.actionableCount != null
                ? normalizeCount(raw.actionableCount)
                : actionableOpsCount + reviewOrders + failedOrders
        };
    }

    function normalizeInventorySummary(summary = {}) {
        const raw = summary && typeof summary === 'object' && !Array.isArray(summary)
            ? summary
            : {};
        const lowStockCount = normalizeCount(raw.lowStockCount);
        const soldOutCount = normalizeCount(raw.soldOutCount);
        const deliveryRiskProductCount = normalizeCount(raw.deliveryRiskProductCount);
        return {
            ...createDefaultInventorySummary(),
            ready: raw.ready === true,
            status: sanitizeText(raw.status, 40).toLowerCase() || (raw.ready === true ? 'ready' : 'idle'),
            lowStockCount,
            soldOutCount,
            deliveryRiskProductCount,
            purchaseConversionRate: Number.isFinite(Number(raw.purchaseConversionRate))
                ? Number(raw.purchaseConversionRate)
                : null,
            orderCount: normalizeCount(raw.orderCount),
            activeProducts: normalizeCount(raw.activeProducts),
            recentItems: normalizeRecentItems(raw.recentItems),
            actionableCount: raw.actionableCount != null
                ? normalizeCount(raw.actionableCount)
                : lowStockCount + soldOutCount + deliveryRiskProductCount,
            lastMessage: sanitizeText(raw.lastMessage, 180)
        };
    }

    function normalizeAISummary(summary = {}) {
        const raw = summary && typeof summary === 'object' && !Array.isArray(summary)
            ? summary
            : {};
        const configured = raw.configured === true;
        const lastResponseOk = raw.lastResponseOk === true
            ? true
            : (raw.lastResponseOk === false ? false : null);
        return {
            ...createDefaultAISummary(),
            ready: raw.ready === true,
            status: sanitizeText(raw.status, 40).toLowerCase()
                || (configured ? 'ready' : 'idle'),
            configured,
            service: sanitizeText(raw.service, 40).toLowerCase(),
            serviceLabel: sanitizeText(raw.serviceLabel, 80),
            model: sanitizeText(raw.model, 120),
            source: sanitizeText(raw.source, 40).toLowerCase(),
            budgetTier: sanitizeText(raw.budgetTier, 40).toLowerCase(),
            estimatedInputTokens: normalizeCount(raw.estimatedInputTokens),
            maxOutputTokens: normalizeCount(raw.maxOutputTokens),
            truncated: raw.truncated === true,
            truncatedChars: normalizeCount(raw.truncatedChars),
            lastLatencyMs: Math.max(0, Number(raw.lastLatencyMs || 0) || 0),
            lastOutputChars: normalizeCount(raw.lastOutputChars),
            lastResponseOk,
            lastMessage: sanitizeText(raw.lastMessage, 180),
            recentItems: normalizeRecentItems(raw.recentItems),
            actionableCount: raw.actionableCount != null
                ? normalizeCount(raw.actionableCount)
                : (!configured || lastResponseOk === false ? 1 : 0)
        };
    }

    function normalizeSecuritySummary(summary = {}) {
        const raw = summary && typeof summary === 'object' && !Array.isArray(summary)
            ? summary
            : {};
        const anomalyCount = normalizeCount(raw.anomalyCount);
        const activeProblemCount = normalizeCount(raw.activeProblemCount);
        return {
            ...createDefaultSecuritySummary(),
            ready: raw.ready === true,
            status: sanitizeText(raw.status, 40).toLowerCase() || (raw.ready === true ? 'ready' : 'idle'),
            accessCount: normalizeCount(raw.accessCount),
            anomalyCount,
            configChangeCount: normalizeCount(raw.configChangeCount),
            secretDeleteCount: normalizeCount(raw.secretDeleteCount),
            mockSwitchCount: normalizeCount(raw.mockSwitchCount),
            distinctAdminCount: normalizeCount(raw.distinctAdminCount),
            distinctIpCount: normalizeCount(raw.distinctIpCount),
            activeProblemCount,
            recentItems: normalizeRecentItems(raw.recentItems),
            actionableCount: raw.actionableCount != null
                ? normalizeCount(raw.actionableCount)
                : activeProblemCount
        };
    }

    function getRuntimeNotificationsSummary() {
        if (typeof window.getAdminChatCommandCenterSummary === 'function') {
            return normalizeNotificationsSummary(window.getAdminChatCommandCenterSummary());
        }
        return createDefaultNotificationsSummary();
    }

    function getRuntimePaymentsSummary() {
        if (typeof window.AdminPayments?.getCommandCenterSummary === 'function') {
            return normalizePaymentsSummary(window.AdminPayments.getCommandCenterSummary());
        }
        return createDefaultPaymentsSummary();
    }

    function getRuntimeInventorySummary() {
        if (typeof window.getAnalyticsCommandCenterInventorySummary === 'function') {
            return normalizeInventorySummary(window.getAnalyticsCommandCenterInventorySummary());
        }
        return createDefaultInventorySummary();
    }

    function getRuntimeAISummary() {
        if (typeof window.AdminAI?.getCommandCenterSummary === 'function') {
            return normalizeAISummary(window.AdminAI.getCommandCenterSummary());
        }
        return {
            ...createDefaultAISummary(),
            configured: Boolean(state.aiBudget),
            actionableCount: state.aiBudget ? 0 : 1
        };
    }

    function getRuntimeSecuritySummary() {
        if (typeof window.getAdminAuditMonitorCommandCenterSummary === 'function') {
            return normalizeSecuritySummary(window.getAdminAuditMonitorCommandCenterSummary());
        }
        const fallbackCount = isSecurityActionable() ? 1 : 0;
        return {
            ...createDefaultSecuritySummary(),
            anomalyCount: fallbackCount,
            actionableCount: fallbackCount
        };
    }

    function applyNotificationsSummary(summary = {}, options = {}) {
        state.notificationsSummary = normalizeNotificationsSummary(summary);
        if (options.render !== false) {
            render();
        }
        return state.notificationsSummary;
    }

    function applyPaymentsSummary(summary = {}, options = {}) {
        state.paymentsSummary = normalizePaymentsSummary(summary);
        if (options.render !== false) {
            render();
        }
        return state.paymentsSummary;
    }

    function applyInventorySummary(summary = {}, options = {}) {
        state.inventorySummary = normalizeInventorySummary(summary);
        if (options.render !== false) {
            render();
        }
        return state.inventorySummary;
    }

    function applyAISummary(summary = {}, options = {}) {
        state.aiSummary = normalizeAISummary(summary);
        if (options.render !== false) {
            render();
        }
        return state.aiSummary;
    }

    function applySecuritySummary(summary = {}, options = {}) {
        state.securitySummary = normalizeSecuritySummary(summary);
        if (options.render !== false) {
            render();
        }
        return state.securitySummary;
    }

    function syncPulseSummaries(options = {}) {
        applyNotificationsSummary(getRuntimeNotificationsSummary(), { render: false });
        applyPaymentsSummary(getRuntimePaymentsSummary(), { render: false });
        applyInventorySummary(getRuntimeInventorySummary(), { render: false });
        applyAISummary(getRuntimeAISummary(), { render: false });
        applySecuritySummary(getRuntimeSecuritySummary(), { render: false });
        if (options.render === true) {
            render();
        }
    }

    function markCommandCenterTiming(name = '', detail = {}) {
        if (typeof window.AdminStudioTiming?.mark === 'function') {
            window.AdminStudioTiming.mark(`command-center:${name}`, detail);
        }
    }

    function markCommandCenterTimingOnce(name = '', detail = {}) {
        if (typeof window.AdminStudioTiming?.markOnce === 'function') {
            window.AdminStudioTiming.markOnce(`command-center:${name}`, detail);
            return;
        }
        markCommandCenterTiming(name, detail);
    }

    function measureCommandCenterTiming(name = '', startName = '', endName = '', detail = {}) {
        if (typeof window.AdminStudioTiming?.measure === 'function') {
            window.AdminStudioTiming.measure(
                `command-center:${name}`,
                `command-center:${startName}`,
                `command-center:${endName}`,
                detail
            );
        }
    }

    function runPulseSummaryPrime(key = '', options = {}, loadSummary, applySummary) {
        const normalizedKey = sanitizeText(key, 40).toLowerCase();
        const force = options.force === true;
        const detail = {
            key: normalizedKey,
            force,
            site: state.site
        };
        const startName = `prime:${normalizedKey}:start`;
        const endName = `prime:${normalizedKey}:end`;
        markCommandCenterTiming(startName, detail);

        let taskPromise;
        try {
            taskPromise = Promise.resolve(loadSummary({ force }));
        } catch (error) {
            taskPromise = Promise.reject(error);
        }

        return taskPromise
            .then((summary) => applySummary(summary))
            .catch((error) => {
                console.warn(`[AdminCommandCenter] Failed to prime ${normalizedKey} summary:`, error);
            })
            .finally(() => {
                markCommandCenterTiming(endName, detail);
                measureCommandCenterTiming(`prime:${normalizedKey}`, startName, endName, detail);
            });
    }

    function primePulseSummaryByKey(key = '', options = {}) {
        const normalizedKey = sanitizeText(key, 40).toLowerCase();
        const force = options.force === true;

        if (normalizedKey === 'notifications' && typeof window.primeAdminChatCommandCenterSummary === 'function') {
            return runPulseSummaryPrime(
                normalizedKey,
                { force },
                (primeOptions) => window.primeAdminChatCommandCenterSummary(primeOptions),
                applyNotificationsSummary
            );
        }

        if (normalizedKey === 'payments' && typeof window.AdminPayments?.primeCommandCenterSummary === 'function') {
            return runPulseSummaryPrime(
                normalizedKey,
                { force },
                (primeOptions) => window.AdminPayments.primeCommandCenterSummary(primeOptions),
                applyPaymentsSummary
            );
        }

        if (normalizedKey === 'inventory' && typeof window.primeAnalyticsCommandCenterInventorySummary === 'function') {
            return runPulseSummaryPrime(
                normalizedKey,
                { force },
                (primeOptions) => window.primeAnalyticsCommandCenterInventorySummary(primeOptions),
                applyInventorySummary
            );
        }

        if (normalizedKey === 'ai' && typeof window.AdminAI?.primeCommandCenterSummary === 'function') {
            return runPulseSummaryPrime(
                normalizedKey,
                { force },
                (primeOptions) => window.AdminAI.primeCommandCenterSummary(primeOptions),
                applyAISummary
            );
        }

        if (normalizedKey === 'security' && typeof window.primeAdminAuditMonitorCommandCenterSummary === 'function') {
            return runPulseSummaryPrime(
                normalizedKey,
                { force },
                (primeOptions) => window.primeAdminAuditMonitorCommandCenterSummary(primeOptions),
                applySecuritySummary
            );
        }

        return null;
    }

    async function primePulseSummaries(options = {}) {
        const keys = Array.isArray(options.keys) && options.keys.length
            ? options.keys
            : COMMAND_CENTER_IMMEDIATE_PRIME_KEYS;
        const tasks = keys
            .map((key) => primePulseSummaryByKey(key, options))
            .filter(Boolean);
        return Promise.allSettled(tasks);
    }

    function clearDeferredPulseSummaryPrimes() {
        state.pulsePrimeTimerIds.forEach((timerId) => cancelCommandCenterTask(timerId));
        state.pulsePrimeTimerIds = [];
        state.pulsePrimeToken += 1;
    }

    function scheduleDeferredPulseSummaries(options = {}) {
        clearDeferredPulseSummaryPrimes();
        const token = state.pulsePrimeToken;
        COMMAND_CENTER_DEFERRED_PRIME_STAGES.forEach((stage) => {
            markCommandCenterTiming(`prime:${stage.key}:scheduled`, {
                key: stage.key,
                delayMs: stage.delayMs,
                site: state.site,
                force: options.force === true
            });
            let timerId = 0;
            timerId = scheduleCommandCenterTask(() => {
                if (state.pulsePrimeToken !== token) {
                    return;
                }
                state.pulsePrimeTimerIds = state.pulsePrimeTimerIds.filter((id) => id !== timerId);
                void primePulseSummaryByKey(stage.key, options);
            }, stage.delayMs);
            if (timerId) {
                state.pulsePrimeTimerIds.push(timerId);
            }
        });
    }

    function formatCountMetric(summary = {}, value = 0, unit = '条') {
        const normalizedSummary = summary && typeof summary === 'object' ? summary : {};
        const status = sanitizeText(normalizedSummary.status, 40).toLowerCase();
        if (status === 'error') {
            return '加载失败';
        }
        if (normalizedSummary.ready !== true) {
            return '同步中';
        }
        return `${normalizeCount(value)}${unit}`;
    }

    function formatPercentMetric(summary = {}, value = null) {
        const normalizedSummary = summary && typeof summary === 'object' ? summary : {};
        const status = sanitizeText(normalizedSummary.status, 40).toLowerCase();
        if (status === 'error') {
            return '加载失败';
        }
        if (normalizedSummary.ready !== true) {
            return '同步中';
        }
        if (!Number.isFinite(Number(value))) {
            return '—';
        }
        const numeric = Number(value);
        const precision = Math.abs(numeric - Math.round(numeric)) < 0.05 ? 0 : 1;
        return `${numeric.toFixed(precision)}%`;
    }

    function formatTextMetric(summary = {}, value = '', emptyValue = '—') {
        const normalizedSummary = summary && typeof summary === 'object' ? summary : {};
        const status = sanitizeText(normalizedSummary.status, 40).toLowerCase();
        if (status === 'error') {
            return '加载失败';
        }
        if (normalizedSummary.ready !== true) {
            return '同步中';
        }
        return sanitizeText(value, 120) || emptyValue;
    }

    function formatTokenMetric(summary = {}, value = 0) {
        const normalizedSummary = summary && typeof summary === 'object' ? summary : {};
        const status = sanitizeText(normalizedSummary.status, 40).toLowerCase();
        if (status === 'error') {
            return '加载失败';
        }
        if (normalizedSummary.ready !== true) {
            return '同步中';
        }
        const normalizedValue = normalizeCount(value);
        return normalizedValue ? `${normalizedValue} token` : '未设置';
    }

    function formatLatencyMetric(summary = {}, value = 0) {
        const normalizedSummary = summary && typeof summary === 'object' ? summary : {};
        const status = sanitizeText(normalizedSummary.status, 40).toLowerCase();
        if (status === 'error') {
            return '加载失败';
        }
        if (normalizedSummary.ready !== true) {
            return '同步中';
        }
        const durationMs = Math.max(0, Number(value || 0) || 0);
        if (!durationMs) {
            return '暂无请求';
        }
        if (durationMs >= 1000) {
            const seconds = durationMs / 1000;
            const precision = seconds >= 10 ? 0 : 1;
            return `${seconds.toFixed(precision)}秒`;
        }
        return `${Math.round(durationMs)}ms`;
    }

    function normalizeFeedbackState(value = '') {
        const normalized = sanitizeText(value, 60).toLowerCase();
        if (normalized === 'processing' || normalized === 'loading' || normalized === 'info' || normalized === 'pending') {
            return 'loading';
        }
        if (normalized === 'success' || normalized === 'saved' || normalized === 'done' || normalized === 'complete') {
            return 'saved';
        }
        if (normalized === 'warning' || normalized === 'partial') {
            return 'partial';
        }
        if (normalized === 'error' || normalized === 'failed' || normalized === 'danger') {
            return 'failed';
        }
        return 'ready';
    }

    function getFeedbackStateLabel(value = '') {
        return FEEDBACK_STATE_LABELS[normalizeFeedbackState(value)] || FEEDBACK_STATE_LABELS.ready;
    }

    function formatFeedbackAge(timestamp = Date.now()) {
        const diffMs = Math.max(0, Date.now() - (Number(timestamp) || Date.now()));
        if (diffMs < 15000) {
            return '刚刚';
        }

        const diffMinutes = Math.floor(diffMs / 60000);
        if (diffMinutes < 60) {
            return `${diffMinutes} 分钟前`;
        }

        const diffHours = Math.floor(diffMinutes / 60);
        if (diffHours < 24) {
            return `${diffHours} 小时前`;
        }

        return `${Math.floor(diffHours / 24)} 天前`;
    }

    function getFeedbackSourceLabel(source = '') {
        const normalized = sanitizeText(source, 60).toLowerCase();
        return FEEDBACK_SOURCE_LABELS[normalized] || normalized || '后台反馈';
    }

    function parseDataObject(value = '', maxLength = 2400) {
        const raw = sanitizeText(value, maxLength);
        if (!raw) {
            return {};
        }
        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (_) {
            return {};
        }
    }

    function serializeDataObject(value = {}) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return '';
        }
        try {
            const serialized = JSON.stringify(value);
            return serialized === '{}' ? '' : escapeHtml(serialized);
        } catch (_) {
            return '';
        }
    }

    function getModuleLabel(moduleId = '') {
        const normalized = normalizeModuleId(moduleId);
        return MODULE_LABELS[normalized] || normalized || '未聚焦';
    }

    function getQuickActionState(stateKey = '', moduleId = '') {
        const normalizedStateKey = normalizeActionStateKey(stateKey || moduleId);
        const current = state.quickActionState || {};
        return current.key === normalizedStateKey ? normalizeFeedbackState(current.state) : 'ready';
    }

    function setQuickActionState(stateKey = '', moduleId = '', feedbackState = 'ready') {
        const normalizedStateKey = normalizeActionStateKey(stateKey || moduleId);
        const normalizedModuleId = normalizeModuleId(moduleId);
        state.quickActionState = {
            key: normalizedStateKey,
            moduleId: normalizedModuleId,
            state: normalizeFeedbackState(feedbackState)
        };
        render();
    }

    function compactContextId(value = '') {
        const normalized = sanitizeText(value, 80);
        if (normalized.length <= 22) {
            return normalized;
        }
        return `${normalized.slice(0, 10)}...${normalized.slice(-8)}`;
    }

    function getContextActionLabel(action = '', entity = '') {
        const normalizedAction = sanitizeText(action, 120).toLowerCase();
        if (CONTEXT_ACTION_LABELS[normalizedAction]) {
            return CONTEXT_ACTION_LABELS[normalizedAction];
        }

        const normalizedEntity = sanitizeText(entity, 80).toLowerCase();
        if (normalizedEntity === 'prompt') {
            return 'Prompt 联动';
        }
        if (normalizedEntity === 'ticket') {
            return '工单联动';
        }
        if (normalizedEntity === 'user') {
            return '用户联动';
        }
        if (normalizedEntity === 'payment' || normalizedEntity === 'order') {
            return '订单联动';
        }
        return normalizedAction || '上下文联动';
    }

    function getContextDeliveryLabel(status = '') {
        const normalized = sanitizeText(status, 40).toLowerCase();
        return CONTEXT_DELIVERY_LABELS[normalized] || CONTEXT_DELIVERY_LABELS.delivered;
    }

    function firstContextValue(groups = [], keys = []) {
        for (const group of groups) {
            if (!group || typeof group !== 'object') {
                continue;
            }
            for (const key of keys) {
                const value = sanitizeText(group[key], 120);
                if (value) {
                    return value;
                }
            }
        }
        return '';
    }

    function buildContextFocusLabel(context = {}) {
        const focus = context?.focus && typeof context.focus === 'object' ? context.focus : {};
        const payload = context?.payload && typeof context.payload === 'object' ? context.payload : {};
        const raw = context?.raw && typeof context.raw === 'object' ? context.raw : {};
        const groups = [focus, payload, raw, context];
        const promptId = firstContextValue(groups, ['promptId', 'prompt_id', 'analyticsPromptId', 'analytics_prompt_id']);
        if (promptId) {
            return `Prompt ${compactContextId(promptId)}`;
        }

        const commentId = firstContextValue(groups, ['commentId', 'comment_id', 'focusCommentId', 'focus_comment_id']);
        if (commentId) {
            return `评论 ${compactContextId(commentId)}`;
        }

        const userId = firstContextValue(groups, ['userId', 'user_id']);
        if (userId) {
            return `用户 ${compactContextId(userId)}`;
        }

        const ticketId = firstContextValue(groups, ['ticketId', 'ticket_id']);
        if (ticketId) {
            return `工单 ${compactContextId(ticketId)}`;
        }

        const orderId = firstContextValue(groups, ['orderId', 'order_id']);
        if (orderId) {
            return `订单 ${compactContextId(orderId)}`;
        }

        const paymentOrderId = firstContextValue(groups, ['paymentOrderId', 'payment_order_id']);
        if (paymentOrderId) {
            return `支付 ${compactContextId(paymentOrderId)}`;
        }

        const sectionId = firstContextValue(groups, ['sectionId', 'section_id', 'focusTargetId', 'focus_target_id']);
        return sectionId ? `区域 ${compactContextId(sectionId)}` : '';
    }

    function buildContextDetailLine(item = {}) {
        return [
            getContextActionLabel(item.action, item.entity),
            item.focusLabel,
            getContextDeliveryLabel(item.status)
        ].filter(Boolean).join(' · ');
    }

    function getCurrentSite() {
        const site = sanitizeText(window.AdminSiteFilter?.getSiteFilter?.() || state.site || 'all', 20).toLowerCase();
        return site || 'all';
    }

    function getActiveModuleId() {
        return normalizeModuleId(window.AdminShell?.getActiveModuleId?.()
            || document.querySelector('.module-container.active')?.id?.replace(/^module-/, '')
            || document.querySelector('.sidebar-item.active[data-module]')?.dataset?.module
            || state.activeModuleId
            || 'gallery');
    }

    function getRoot() {
        return document.getElementById('adminCommandCenter');
    }

    function ensureRoot() {
        let root = getRoot();
        if (root) {
            return root;
        }

        const header = document.querySelector('.studio-header');
        if (!header?.parentNode) {
            return null;
        }

        root = document.createElement('section');
        root.id = 'adminCommandCenter';
        root.className = 'admin-command-center';
        root.setAttribute('aria-label', 'Admin Studio 指挥台');
        header.insertAdjacentElement('afterend', root);
        bindRoot(root);
        return root;
    }

    function getDockButtonByPulseId(root = getRoot(), pulseId = '') {
        const normalizedPulseId = sanitizeText(pulseId, 80);
        if (!normalizedPulseId || typeof root?.querySelector !== 'function') {
            return null;
        }
        try {
            return root.querySelector(`[data-admin-command-pulse="${normalizedPulseId}"]`);
        } catch (_) {
            return null;
        }
    }

    function measurePanelMotion(triggerButton = null) {
        const rect = triggerButton?.getBoundingClientRect?.();
        const viewportWidth = Math.max(0, Number(window.innerWidth) || document.documentElement?.clientWidth || 0);
        const viewportHeight = Math.max(0, Number(window.innerHeight) || document.documentElement?.clientHeight || 0);
        if (!rect || !viewportWidth || !viewportHeight) {
            return createDefaultPanelMotion();
        }

        const panelWidth = Math.max(260, Math.min(430, viewportWidth - 126));
        const panelCenterX = viewportWidth - 76 - panelWidth / 2;
        const panelCenterY = viewportHeight / 2;
        const iconCenterX = rect.left + rect.width / 2;
        const iconCenterY = rect.top + rect.height / 2;

        return {
            shiftX: clampNumber(iconCenterX - panelCenterX, -48, 112),
            shiftY: clampNumber(iconCenterY - panelCenterY, -260, 260),
            scale: 0.78,
            originX: '100%',
            originY: `${clampNumber((iconCenterY / viewportHeight) * 100, 14, 86).toFixed(1)}%`
        };
    }

    function clearPanelPhaseTimer() {
        cancelCommandCenterTask(state.panelPhaseTimerId);
        state.panelPhaseTimerId = 0;
    }

    function schedulePanelPhase(phase = 'open', delay = 0) {
        clearPanelPhaseTimer();
        state.panelPhaseToken += 1;
        const token = state.panelPhaseToken;
        state.panelPhaseTimerId = scheduleCommandCenterTask(() => {
            if (state.panelPhaseToken !== token) {
                return;
            }
            state.panelPhaseTimerId = 0;
            state.panelPhase = sanitizeText(phase, 20) || 'closed';
            syncPanelPhaseDom();
        }, delay);
    }

    function openPanel(pulseId = 'overview', triggerButton = null, options = {}) {
        const nextPulseId = sanitizeText(pulseId, 80) || 'overview';
        const wasPanelVisible = state.panelOpen && state.panelPhase !== 'closed';
        state.activePulseId = nextPulseId;
        state.panelOpen = true;
        state.panelMotion = measurePanelMotion(triggerButton || getDockButtonByPulseId(getRoot(), state.activePulseId));
        if (options.animate === false || wasPanelVisible) {
            clearPanelPhaseTimer();
            state.panelPhase = 'open';
            render();
            return;
        }
        state.panelPhase = 'opening';
        render();
        schedulePanelPhase('open', PANEL_OPEN_ANIMATION_MS);
    }

    function closePanel(triggerButton = null) {
        if (!state.panelOpen && state.panelPhase === 'closed') {
            return;
        }
        state.panelOpen = false;
        state.panelMotion = measurePanelMotion(triggerButton || getDockButtonByPulseId(getRoot(), state.activePulseId));
        state.panelPhase = 'closing';
        render();
        schedulePanelPhase('closed', PANEL_CLOSE_ANIMATION_MS);
    }

    function readCollapsedState() {
        try {
            return window.localStorage?.getItem(STORAGE_KEY) === '1';
        } catch (_) {
            return false;
        }
    }

    function persistCollapsedState(value) {
        try {
            window.localStorage?.setItem(STORAGE_KEY, value ? '1' : '0');
        } catch (_) {
            // Storage can be unavailable in private contexts.
        }
    }

    function getBudgetLine() {
        const budget = state.aiBudget || null;
        if (!budget) {
            return '等待首次请求';
        }

        const tokenLabel = budget.estimatedInputTokens
            ? `${budget.estimatedInputTokens} 输入 token 预估`
            : `${budget.maxOutputTokens || 0} 输出上限`;
        return budget.truncated
            ? `${tokenLabel}，已截断 ${budget.truncatedChars || 0} 字`
            : tokenLabel;
    }

    function getContextLine() {
        const latest = state.contextTrail[0];
        if (!latest) {
            return '暂无跨模块上下文';
        }

        return `${getModuleLabel(latest.source)} -> ${getModuleLabel(latest.destination)}`;
    }

    function renderQuickActions() {
        return QUICK_ACTIONS.map((action) => {
            const actionState = getQuickActionState(action.moduleId, action.moduleId);
            const hasState = actionState !== 'ready';
            const isLoading = actionState === 'loading';
            const iconClass = isLoading ? 'fas fa-spinner fa-spin' : action.icon;
            const stateLabel = getFeedbackStateLabel(actionState);
            return `
            <button class="admin-command-center__quick-btn${hasState ? ` is-${escapeHtml(actionState)} has-state` : ''}" type="button" data-admin-command-module="${escapeHtml(action.moduleId)}" data-admin-command-state="${escapeHtml(actionState)}" aria-busy="${isLoading ? 'true' : 'false'}" aria-label="${escapeHtml(`${action.label} ${stateLabel}`)}"${isLoading ? ' disabled' : ''}>
                <i class="${escapeHtml(iconClass)}" aria-hidden="true"></i>
                <span>${escapeHtml(action.label)}</span>
                <small class="admin-command-center__quick-state" aria-hidden="true">${escapeHtml(stateLabel)}</small>
            </button>
        `;
        }).join('');
    }

    function renderContextTrail() {
        if (!state.contextTrail.length) {
            return '<div class="admin-command-center__empty">联动会在这里沉淀</div>';
        }

        return state.contextTrail.slice(0, 3).map((item) => `
            <div class="admin-command-center__trail-item">
                <div class="admin-command-center__trail-route">
                    <span>${escapeHtml(getModuleLabel(item.source))}</span>
                    <i class="fas fa-arrow-right" aria-hidden="true"></i>
                    <strong>${escapeHtml(getModuleLabel(item.destination))}</strong>
                </div>
                <small class="admin-command-center__trail-detail">${escapeHtml(buildContextDetailLine(item))}</small>
            </div>
        `).join('');
    }

    function rememberFeedbackSignal(detail = {}) {
        const message = sanitizeText(detail?.message, 180);
        if (!message) {
            return;
        }

        const nextItem = {
            id: `signal_${Date.now()}_${state.feedbackSeed += 1}`,
            state: normalizeFeedbackState(detail?.state || detail?.tone || detail?.type || ''),
            label: getFeedbackStateLabel(detail?.state || detail?.tone || detail?.type || ''),
            message,
            moduleId: normalizeModuleId(detail?.module || state.activeModuleId || getActiveModuleId()),
            sourceLabel: getFeedbackSourceLabel(detail?.source || detail?.kind || ''),
            pulseId: sanitizeText(detail?.pulseId, 40).toLowerCase(),
            persistent: Boolean(detail?.persistent),
            timestamp: Number(detail?.timestamp || detail?.at || Date.now()) || Date.now()
        };

        const latest = state.feedbackSignals[0];
        if (latest && latest.message === nextItem.message && latest.state === nextItem.state && latest.sourceLabel === nextItem.sourceLabel) {
            state.feedbackSignals[0] = {
                ...latest,
                moduleId: nextItem.moduleId || latest.moduleId,
                pulseId: nextItem.pulseId || latest.pulseId || '',
                persistent: nextItem.persistent,
                timestamp: nextItem.timestamp
            };
        } else {
            state.feedbackSignals.unshift(nextItem);
            state.feedbackSignals = state.feedbackSignals.slice(0, 12);
        }

        state.lastSignal = `${getFeedbackStateLabel(nextItem.state)} · ${message}`;
    }

    function renderFeedbackSignals() {
        if (!state.feedbackSignals.length) {
            return '<div class="admin-command-center__signal-empty">最近操作完成后会在这里留下回执</div>';
        }

        return state.feedbackSignals.slice(0, 3).map((item) => `
            <article class="admin-command-center__signal admin-command-center__signal--${escapeHtml(item.state)}">
                <div class="admin-command-center__signal-head">
                    <span class="admin-command-center__signal-badge">${escapeHtml(item.label)}</span>
                    <span class="admin-command-center__signal-meta">${escapeHtml(getModuleLabel(item.moduleId))} · ${escapeHtml(item.sourceLabel)} · ${escapeHtml(formatFeedbackAge(item.timestamp))}</span>
                </div>
                <div class="admin-command-center__signal-copy">${escapeHtml(item.message)}</div>
            </article>
        `).join('');
    }

    function getActionableFeedbackCount(moduleId = '') {
        const normalizedModuleId = normalizeModuleId(moduleId);
        return state.feedbackSignals.filter((item) => {
            if (normalizedModuleId && item.moduleId !== normalizedModuleId) {
                return false;
            }
            return item.state === 'failed' || item.state === 'partial';
        }).length;
    }

    function buildChatQueueAction({
        label = '',
        stateKey = '',
        feedbackLabel = '',
        intent = '',
        queueView = 'all',
        queueFilter = '',
        primary = false
    } = {}) {
        const payload = {
            queueView
        };
        if (queueFilter) {
            payload.queueFilter = queueFilter;
        }
        return {
            label,
            moduleId: 'chat',
            stateKey,
            feedbackLabel,
            intent,
            context: { payload },
            primary
        };
    }

    function buildOpsAlertsAction({
        label = '',
        stateKey = '',
        feedbackLabel = '',
        intent = '',
        view = 'overview',
        focusTargetId = '',
        primary = false
    } = {}) {
        const payload = {
            view,
            defaultTab: view,
            tab: view
        };
        if (focusTargetId) {
            payload.focusTargetId = focusTargetId;
        }
        const options = {
            viewName: view
        };
        if (focusTargetId) {
            options.focusTargetId = focusTargetId;
        }
        return {
            label,
            moduleId: 'ops-alerts',
            stateKey,
            feedbackLabel,
            intent,
            context: { payload },
            options,
            primary
        };
    }

    function buildPaymentsAction({
        label = '',
        stateKey = '',
        feedbackLabel = '',
        intent = '',
        defaultTab = 'ops',
        issueSummary = '',
        focusTargetId = '',
        priorityAction = '',
        exceptionTopic = '',
        primary = false
    } = {}) {
        const payload = {
            defaultTab,
            tab: defaultTab
        };
        if (issueSummary) {
            payload.issueSummary = issueSummary;
        }
        if (focusTargetId) {
            payload.focusTargetId = focusTargetId;
        }
        if (priorityAction) {
            payload.priorityAction = priorityAction;
        }
        if (exceptionTopic) {
            payload.exceptionTopic = exceptionTopic;
        }
        return {
            label,
            moduleId: 'payments',
            stateKey,
            feedbackLabel,
            intent,
            context: { payload },
            options: {
                defaultTab,
                tab: defaultTab
            },
            primary
        };
    }

    function buildSettingsAction({
        label = '',
        stateKey = '',
        feedbackLabel = '',
        intent = '',
        viewName = 'security',
        workspace = '',
        focusTargetId = '',
        primary = false
    } = {}) {
        const payload = {
            defaultTab: viewName
        };
        if (workspace) {
            payload.workspace = workspace;
        }
        if (focusTargetId) {
            payload.focusTargetId = focusTargetId;
        }
        const options = {
            viewName,
            settingsView: viewName
        };
        if (workspace) {
            options.workspace = workspace;
        }
        if (focusTargetId) {
            options.focusTargetId = focusTargetId;
        }
        return {
            label,
            moduleId: 'settings',
            stateKey,
            feedbackLabel,
            intent,
            context: {
                action: viewName,
                payload
            },
            options,
            primary
        };
    }

    function buildDiscountsAction({
        label = '',
        stateKey = '',
        feedbackLabel = '',
        intent = '',
        title = '',
        search = '',
        referenceLabel = '',
        referenceValue = '',
        signalType = '',
        primary = false
    } = {}) {
        const payload = {};
        if (title) {
            payload.title = title;
        }
        if (search) {
            payload.search = search;
        }
        if (referenceLabel) {
            payload.referenceLabel = referenceLabel;
        }
        if (referenceValue) {
            payload.referenceValue = referenceValue;
        }
        if (signalType) {
            payload.signalType = signalType;
        }
        return {
            label,
            moduleId: 'discounts',
            stateKey,
            feedbackLabel,
            intent,
            context: { payload },
            primary
        };
    }

    function getPulseTimelineModuleIds(pulseId = '') {
        const normalizedPulseId = sanitizeText(pulseId, 40).toLowerCase();
        if (normalizedPulseId === 'overview') {
            return [];
        }
        if (normalizedPulseId === 'notifications') {
            return ['chat', 'ops-alerts', 'payments'];
        }
        if (normalizedPulseId === 'payments') {
            return ['payments'];
        }
        if (normalizedPulseId === 'inventory') {
            return ['shop', 'discounts', 'shop-orders', 'shop-inventory'];
        }
        if (normalizedPulseId === 'budget') {
            return ['settings'];
        }
        if (normalizedPulseId === 'security') {
            return ['settings', 'users'];
        }
        return [];
    }

    function getTimelineToneFromFeedbackState(value = '') {
        const normalized = normalizeFeedbackState(value);
        if (normalized === 'saved') {
            return 'ok';
        }
        if (normalized === 'partial' || normalized === 'loading') {
            return 'warn';
        }
        if (normalized === 'failed') {
            return 'alert';
        }
        return '';
    }

    function getRealtimePulseTimeline(item = {}) {
        const pulseId = sanitizeText(item.id, 40).toLowerCase();
        const relatedModules = getPulseTimelineModuleIds(pulseId);
        const feedbackRows = state.feedbackSignals.filter((signal) => {
            if (pulseId === 'overview') {
                return true;
            }
            if (signal.pulseId) {
                return signal.pulseId === pulseId;
            }
            return relatedModules.includes(signal.moduleId);
        }).slice(0, 3).map((signal) => {
            const label = signal.sourceLabel === '指挥台'
                ? getModuleLabel(signal.moduleId)
                : signal.sourceLabel;
            return [
                label || getModuleLabel(signal.moduleId),
                signal.message,
                formatFeedbackAge(signal.timestamp),
                getTimelineToneFromFeedbackState(signal.state)
            ];
        });
        if (feedbackRows.length) {
            return feedbackRows;
        }

        const contextRows = state.contextTrail.filter((entry) => {
            if (pulseId === 'overview') {
                return true;
            }
            const sourceModuleId = normalizeModuleId(entry.source);
            const destinationModuleId = normalizeModuleId(entry.destination);
            return relatedModules.includes(sourceModuleId) || relatedModules.includes(destinationModuleId);
        }).slice(0, 3).map((entry) => [
            getModuleLabel(entry.destination),
            buildContextDetailLine(entry),
            formatFeedbackAge(entry.at),
            entry.status === 'failed' ? 'alert' : (entry.status === 'unhandled' ? 'warn' : 'ok')
        ]);
        if (contextRows.length) {
            return contextRows;
        }

        const summaryRows = getSummaryPulseTimeline(item);
        if (summaryRows.length) {
            return summaryRows;
        }

        return Array.isArray(item.timeline) ? item.timeline : [];
    }

    function isSecurityActionable() {
        const normalized = sanitizeText(state.securityStatus, 120).toLowerCase();
        return /异常|失败|未确认|blocked|failed|danger|error/.test(normalized);
    }

    function getAIOverviewMetric(aiSummary = {}) {
        const normalizedSummary = normalizeAISummary(aiSummary);
        if (normalizedSummary.status === 'error') {
            return '请求异常';
        }
        if (normalizedSummary.ready !== true) {
            return state.aiBudget ? '已配置' : '同步中';
        }
        if (!normalizedSummary.configured) {
            return '待配置';
        }
        if (normalizedSummary.lastResponseOk === false) {
            return '请求异常';
        }
        return '已配置';
    }

    function getInventoryStateLine(inventorySummary = {}, count = 0) {
        const normalizedSummary = normalizeInventorySummary(inventorySummary);
        if (normalizedSummary.status === 'error') {
            return '摘要异常';
        }
        if (normalizedSummary.ready !== true) {
            return '同步中';
        }
        return count ? `${count} 项提醒` : '当前正常';
    }

    function getAIPulseStateLine(aiSummary = {}, count = 0) {
        const normalizedSummary = normalizeAISummary(aiSummary);
        if (normalizedSummary.status === 'error' || normalizedSummary.lastResponseOk === false) {
            return '请求异常';
        }
        if (normalizedSummary.ready !== true) {
            return state.aiBudget ? '已配置' : '同步中';
        }
        if (!normalizedSummary.configured) {
            return '配置待完成';
        }
        return count ? `${count} 项待处理` : '当前正常';
    }

    function getAIPriorityLabel(aiSummary = {}, count = 0) {
        const normalizedSummary = normalizeAISummary(aiSummary);
        if (normalizedSummary.status === 'error' || normalizedSummary.lastResponseOk === false || count > 0) {
            return normalizedSummary.configured ? 'P2 需修复' : '待配置';
        }
        if (normalizedSummary.ready !== true) {
            return '同步中';
        }
        return '当前正常';
    }

    function getAIPriorityClass(aiSummary = {}, count = 0) {
        const normalizedSummary = normalizeAISummary(aiSummary);
        if (normalizedSummary.status === 'error' || normalizedSummary.lastResponseOk === false) {
            return 'is-alert';
        }
        if (!normalizedSummary.configured || count > 0) {
            return 'is-warn';
        }
        return 'is-ok';
    }

    function getAINote(aiSummary = {}) {
        const normalizedSummary = normalizeAISummary(aiSummary);
        if (normalizedSummary.status === 'error' && normalizedSummary.lastMessage) {
            return `${normalizedSummary.lastMessage}；配置入口仍在通用设置里的 Codex Relay 配置。`;
        }
        if (!normalizedSummary.configured) {
            return normalizedSummary.lastMessage
                || '当前还没有真实的日成本或预算数据源，这里只提示配置状态与入口，不再展示虚构占用。';
        }
        if (normalizedSummary.lastResponseOk === false && normalizedSummary.lastMessage) {
            return `${normalizedSummary.lastMessage}；这里保留最近一次失败状态，方便直接回去修复。`;
        }
        const serviceLabel = normalizedSummary.serviceLabel || normalizedSummary.service || 'AI 服务';
        const modelLabel = normalizedSummary.model || '默认模型';
        return `${serviceLabel} · ${modelLabel} 已接入；当前只展示真实配置与最近运行态，不再虚构今日成本。`;
    }

    function buildInventoryTimeline(summary = {}) {
        const normalizedSummary = normalizeInventorySummary(summary);
        if (normalizedSummary.status === 'error') {
            return [
                ['摘要异常', normalizedSummary.lastMessage || '商品经营摘要同步失败', '刚同步', 'alert']
            ];
        }
        if (normalizedSummary.ready !== true) {
            return [
                ['同步中', '商品经营摘要正在刷新', '刚同步', '']
            ];
        }
        return [
            [
                '低库存',
                normalizedSummary.lowStockCount
                    ? `${normalizedSummary.lowStockCount} 个商品低于库存阈值`
                    : '当前没有低库存商品',
                '刚同步',
                normalizedSummary.lowStockCount ? 'warn' : 'ok'
            ],
            [
                '售罄',
                normalizedSummary.soldOutCount
                    ? `${normalizedSummary.soldOutCount} 个商品已售罄`
                    : '当前没有售罄商品',
                '刚同步',
                normalizedSummary.soldOutCount ? 'warn' : 'ok'
            ],
            [
                '转化',
                Number.isFinite(Number(normalizedSummary.purchaseConversionRate))
                    ? `当前购买转化 ${formatPercentMetric(normalizedSummary, normalizedSummary.purchaseConversionRate)}`
                    : '暂无新的转化摘要',
                '刚同步',
                Number.isFinite(Number(normalizedSummary.purchaseConversionRate)) ? 'ok' : ''
            ]
        ];
    }

    function buildAITimeline(summary = {}) {
        const normalizedSummary = normalizeAISummary(summary);
        if (normalizedSummary.status === 'error') {
            return [
                ['运行态', normalizedSummary.lastMessage || 'AI 运行态同步失败', '刚同步', 'alert']
            ];
        }
        if (normalizedSummary.ready !== true) {
            return [
                ['同步中', 'AI 配置与运行态正在刷新', '刚同步', '']
            ];
        }
        const serviceLine = normalizedSummary.configured
            ? `${normalizedSummary.serviceLabel || normalizedSummary.service || 'AI 服务'} · ${normalizedSummary.model || '默认模型'}`
            : (normalizedSummary.lastMessage || '尚未完成 AI 配置');
        const runtimeLine = normalizedSummary.lastResponseOk === false
            ? (normalizedSummary.lastMessage || '最近一次请求失败')
            : (normalizedSummary.lastLatencyMs
                ? `最近一次请求耗时 ${formatLatencyMetric(normalizedSummary, normalizedSummary.lastLatencyMs)}`
                : '尚无最近请求记录');
        return [
            [
                '服务',
                serviceLine,
                '刚同步',
                normalizedSummary.configured ? 'ok' : 'warn'
            ],
            [
                '输出',
                normalizedSummary.maxOutputTokens
                    ? `${formatTokenMetric(normalizedSummary, normalizedSummary.maxOutputTokens)} 输出上限`
                    : '尚未设置输出上限',
                '刚同步',
                normalizedSummary.maxOutputTokens ? 'ok' : ''
            ],
            [
                '运行态',
                runtimeLine,
                '刚同步',
                normalizedSummary.lastResponseOk === false ? 'alert' : (normalizedSummary.lastLatencyMs ? 'ok' : '')
            ]
        ];
    }

    function sortRecentItems(items = []) {
        return (Array.isArray(items) ? items : [])
            .map((item, index) => ({
                ...(item && typeof item === 'object' ? item : {}),
                __index: index
            }))
            .sort((left, right) => {
                const leftTimestamp = Number(left?.timestamp || 0) || 0;
                const rightTimestamp = Number(right?.timestamp || 0) || 0;
                if (leftTimestamp === rightTimestamp) {
                    return Number(left?.__index || 0) - Number(right?.__index || 0);
                }
                return rightTimestamp - leftTimestamp;
            })
            .map((item) => {
                const nextItem = { ...item };
                delete nextItem.__index;
                return nextItem;
            });
    }

    function getSummaryRecentItemsForPulse(pulseId = '') {
        const normalizedPulseId = sanitizeText(pulseId, 40).toLowerCase();
        const notificationsSummary = normalizeNotificationsSummary(state.notificationsSummary);
        const paymentsSummary = normalizePaymentsSummary(state.paymentsSummary);
        const inventorySummary = normalizeInventorySummary(state.inventorySummary);
        const aiSummary = normalizeAISummary(state.aiSummary);
        const securitySummary = normalizeSecuritySummary(state.securitySummary);

        if (normalizedPulseId === 'notifications') {
            return notificationsSummary.recentItems;
        }
        if (normalizedPulseId === 'payments') {
            return paymentsSummary.recentItems;
        }
        if (normalizedPulseId === 'inventory') {
            return inventorySummary.recentItems;
        }
        if (normalizedPulseId === 'budget') {
            return aiSummary.recentItems;
        }
        if (normalizedPulseId === 'security') {
            return securitySummary.recentItems;
        }
        if (normalizedPulseId === 'overview') {
            return sortRecentItems([
                ...notificationsSummary.recentItems,
                ...paymentsSummary.recentItems,
                ...inventorySummary.recentItems,
                ...aiSummary.recentItems,
                ...securitySummary.recentItems
            ]).slice(0, 3);
        }
        return [];
    }

    function getSummaryPulseTimeline(item = {}) {
        const pulseId = sanitizeText(item.id, 40).toLowerCase();
        return getSummaryRecentItemsForPulse(item.id).slice(0, 3).map((entry, index) => ({
            ...entry,
            timeLabel: entry.timeLabel || (entry.timestamp ? formatFeedbackAge(entry.timestamp) : '刚同步'),
            stateKey: entry.moduleId
                ? normalizeActionStateKey(entry.stateKey || `${pulseId}-${entry.moduleId}-recent-${index}`)
                : ''
        }));
    }

    function normalizePulseTimelineRow(entry = {}, index = 0, pulseId = '') {
        if (Array.isArray(entry)) {
            const [label, copy, timeLabel, tone] = entry;
            const normalizedLabel = sanitizeText(label, 80);
            const normalizedCopy = sanitizeText(copy, 180);
            if (!normalizedLabel || !normalizedCopy) {
                return null;
            }
            return {
                label: normalizedLabel,
                copy: normalizedCopy,
                timeLabel: sanitizeText(timeLabel, 40) || '刚同步',
                tone: normalizeTimelineTone(tone)
            };
        }

        const raw = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {};
        const label = sanitizeText(raw.label, 80);
        const copy = sanitizeText(raw.copy || raw.detail || raw.message || raw.summary, 180);
        if (!label || !copy) {
            return null;
        }
        const timestamp = normalizeTimestamp(raw.timestamp || raw.at || raw.createdAt || raw.created_at || raw.updatedAt || raw.updated_at);
        const moduleId = normalizeModuleId(raw.moduleId || raw.module || raw.module_id);
        return {
            label,
            copy,
            timeLabel: sanitizeText(raw.timeLabel || raw.ageLabel || raw.time, 40)
                || (timestamp ? formatFeedbackAge(timestamp) : '刚同步'),
            tone: normalizeTimelineTone(raw.tone || raw.level || raw.status),
            moduleId,
            stateKey: moduleId
                ? normalizeActionStateKey(raw.stateKey || raw.state_key || `${pulseId}-${moduleId}-recent-${index}`)
                : '',
            feedbackLabel: sanitizeText(raw.feedbackLabel || raw.feedback_label || label, 80),
            intent: sanitizeText(raw.intent || raw.actionLabel || raw.action_label, 180),
            context: normalizeDataObject(raw.context),
            options: normalizeDataObject(raw.options)
        };
    }

    function normalizePulseTimelineRows(rows = [], item = {}) {
        const pulseId = sanitizeText(item.id, 40).toLowerCase();
        return (Array.isArray(rows) ? rows : [])
            .map((entry, index) => normalizePulseTimelineRow(entry, index, pulseId))
            .filter(Boolean)
            .slice(0, 3);
    }

    function getPulseCounts() {
        const notificationsSummary = normalizeNotificationsSummary(state.notificationsSummary);
        const paymentsSummary = normalizePaymentsSummary(state.paymentsSummary);
        const inventorySummary = normalizeInventorySummary(state.inventorySummary);
        const aiSummary = normalizeAISummary(state.aiSummary);
        const securitySummary = normalizeSecuritySummary(state.securitySummary);
        const notifications = notificationsSummary.ready ? notificationsSummary.actionableCount : 0;
        const payments = paymentsSummary.ready ? paymentsSummary.actionableCount : 0;
        const inventory = inventorySummary.ready ? inventorySummary.actionableCount : 0;
        const budget = aiSummary.ready ? aiSummary.actionableCount : 0;
        const security = securitySummary.ready
            ? securitySummary.actionableCount
            : (isSecurityActionable() ? 1 : 0);
        return {
            overview: notifications + payments + inventory + budget + security,
            notifications,
            payments,
            inventory,
            budget,
            security
        };
    }

    function buildPulseItems() {
        const counts = getPulseCounts();
        const notificationsSummary = normalizeNotificationsSummary(state.notificationsSummary);
        const paymentsSummary = normalizePaymentsSummary(state.paymentsSummary);
        const inventorySummary = normalizeInventorySummary(state.inventorySummary);
        const aiSummary = normalizeAISummary(state.aiSummary);
        const securitySummary = normalizeSecuritySummary(state.securitySummary);
        const hasPendingNotificationsReply = notificationsSummary.pendingReply > 0;
        const hasActiveNotificationsAlerts = notificationsSummary.systemAlerts > 0;
        const hasUnreadNotificationsAlerts = notificationsSummary.unreadSystemAlerts > 0;
        const notificationsStateLine = notificationsSummary.ready
            ? (counts.notifications
                ? `${counts.notifications} 项待处理`
                : (hasActiveNotificationsAlerts ? `${notificationsSummary.systemAlerts} 条活跃告警` : '当前无待处理'))
            : '同步中';
        const notificationsPriority = counts.notifications
            ? 'P1 需处理'
            : (hasActiveNotificationsAlerts ? '活跃告警已读' : '当前无待处理');
        const notificationsPriorityClass = counts.notifications
            ? 'is-alert'
            : (hasActiveNotificationsAlerts ? 'is-warn' : 'is-ok');
        const inventoryRestockRecentItem = (Array.isArray(inventorySummary.recentItems) ? inventorySummary.recentItems : []).find((item) => {
            const context = normalizeDataObject(item?.context);
            const payload = normalizeDataObject(context.payload);
            return normalizeModuleId(item?.moduleId) === 'shop'
                && normalizeActionStateKey(item?.stateKey)
                && String(payload.workspace || payload.defaultTab || payload.tab || '').trim().toLowerCase() === 'import';
        }) || null;
        const inventoryRestockContext = inventoryRestockRecentItem
            ? normalizeDataObject(inventoryRestockRecentItem.context)
            : {
                destination: 'shop',
                entity: 'shop-inventory',
                action: 'open-import',
                payload: {
                    workspace: 'import',
                    defaultTab: 'import',
                    tab: 'import'
                }
            };
        const inventoryRestockOptions = inventoryRestockRecentItem
            ? normalizeDataObject(inventoryRestockRecentItem.options)
            : {
                defaultTab: 'import',
                tab: 'import'
            };
        return [
            {
                id: 'overview',
                label: '待办总览',
                stateLine: counts.overview ? `${counts.overview} 项待处理` : '暂无待办',
                icon: 'fas fa-table-cells-large',
                badge: counts.overview,
                badgeClass: counts.overview >= 8 ? 'is-alert' : 'is-warn',
                eyebrow: 'TODAY QUEUE',
                title: '待办总览',
                subtitle: '只汇总需要管理员处理的事项；保存成功、服务正常、0 异常这类信息不再占 Dock 注意力。',
                priority: counts.overview ? `${counts.overview} 项待处理` : '当前无待办',
                priorityClass: counts.overview ? 'is-alert' : 'is-ok',
                route: '运营总览 / 待处理',
                note: '这个入口用于回答一句话：现在有没有事需要我处理？正常信息进入详情，不在 Dock 上挂点。',
                metrics: [
                    ['站内通知', formatCountMetric(notificationsSummary, counts.notifications, '项')],
                    ['支付回调', formatCountMetric(paymentsSummary, counts.payments, '项')],
                    ['订单库存', formatCountMetric(inventorySummary, counts.inventory, '项')],
                    ['AI 配置', getAIOverviewMetric(aiSummary)]
                ],
                actions: [
                    buildChatQueueAction({
                        label: '处理最急',
                        stateKey: 'overview-priority',
                        feedbackLabel: '待回消息',
                        intent: '打开消息中心高优先待回复队列。',
                        queueView: 'priority',
                        queueFilter: 'reply',
                        primary: true
                    }),
                    buildOpsAlertsAction({
                        label: '只看异常',
                        stateKey: 'overview-exceptions',
                        feedbackLabel: '异常监控',
                        intent: '打开告警监控，只看当前异常项。',
                        view: 'monitors'
                    }),
                    buildChatQueueAction({
                        label: '清理低优先',
                        stateKey: 'overview-low-priority',
                        feedbackLabel: '久未回复',
                        intent: '打开久未回复队列，集中清理低优先项。',
                        queueView: 'all',
                        queueFilter: 'stale_reply'
                    })
                ],
                timeline: [
                    ['P1', '用户消息 2 人待回复', '刚刚', 'alert'],
                    ['P2', '支付回调 2 单等待重试', '2 分钟', 'warn'],
                    ['P2', '低库存 3 个商品待处理', '8 分钟', 'warn']
                ]
            },
            {
                id: 'notifications',
                label: '站内通知',
                stateLine: notificationsStateLine,
                icon: 'fas fa-bell',
                tabClass: 'is-alert',
                badge: counts.notifications,
                badgeClass: 'is-alert',
                eyebrow: 'INBOX',
                title: '站内通知',
                subtitle: '告警、用户消息和系统提醒统一收进右侧 Dock，点开即可回到对应页面处理。',
                priority: notificationsPriority,
                priorityClass: notificationsPriorityClass,
                route: '消息中心 / 未处理',
                note: hasUnreadNotificationsAlerts || hasPendingNotificationsReply
                    ? '右侧 Dock 只挂需要马上处理的未读消息、待回复和未读告警；标记已读后数字会下降，但告警仍会留在工作区直到关闭或恢复。'
                    : (hasActiveNotificationsAlerts
                        ? '当前没有未读提醒，但仍有活跃告警留在工作区；需要继续在告警面板里关闭、恢复或转交。'
                        : '右侧 Dock 只挂需要马上处理的未读消息、待回复和未读告警。'),
                metrics: [
                    ['未读消息', formatCountMetric(notificationsSummary, notificationsSummary.unreadMessages, '条')],
                    ['用户待回', formatCountMetric(notificationsSummary, notificationsSummary.pendingReply, '人')],
                    ['未读告警', formatCountMetric(notificationsSummary, notificationsSummary.unreadSystemAlerts, '条')],
                    ['活跃告警', formatCountMetric(notificationsSummary, notificationsSummary.systemAlerts, '条')]
                ],
                actions: [
                    buildChatQueueAction({
                        label: '处理消息',
                        stateKey: 'notifications-reply',
                        feedbackLabel: '消息待回',
                        intent: '打开消息中心高优先待回复队列。',
                        queueView: 'priority',
                        queueFilter: 'reply',
                        primary: hasPendingNotificationsReply
                    }),
                    buildOpsAlertsAction({
                        label: hasActiveNotificationsAlerts ? '处理告警' : '查看告警',
                        stateKey: 'notifications-alerts',
                        feedbackLabel: '活跃告警',
                        intent: '打开告警工作台；标记已读会让 Dock 数字下降，但告警仍需关闭或恢复。',
                        view: 'workspace',
                        focusTargetId: 'opsAlertMonitorPanel',
                        primary: !hasPendingNotificationsReply && hasActiveNotificationsAlerts
                    }),
                    buildChatQueueAction({
                        label: '清理低优先',
                        stateKey: 'notifications-stale',
                        feedbackLabel: '低优先消息',
                        intent: '打开久未回复队列，优先清理低优先消息；不会关闭活跃告警。',
                        queueView: 'all',
                        queueFilter: 'stale_reply'
                    })
                ],
                timeline: [
                    ['用户消息', '用户询问充值到账时间', '刚刚', 'alert'],
                    ['系统告警', '支付回调延迟超过 3 分钟', '2 分钟', 'warn'],
                    ['库存提醒', 'Google One 库存接近阈值', '8 分钟', 'warn']
                ]
            },
            {
                id: 'payments',
                label: '支付回调',
                stateLine: paymentsSummary.ready
                    ? (counts.payments ? `${counts.payments} 项需复核` : '当前正常')
                    : '同步中',
                icon: 'fas fa-credit-card',
                tabClass: 'is-warn',
                badge: counts.payments,
                badgeClass: 'is-warn',
                eyebrow: 'PAYMENTS',
                title: '支付回调',
                subtitle: '支付、退款、回调重试和人工核验收在一个入口，异常时优先浮到右侧。',
                priority: counts.payments ? 'P2 复核' : '当前正常',
                priorityClass: counts.payments ? 'is-warn' : 'is-ok',
                route: '支付管理 / 回调队列',
                note: '高频动作直接放在脉冲面板里：重试回调、查看订单、打开支付日志，减少来回切页。',
                metrics: [
                    ['待重试', formatCountMetric(paymentsSummary, paymentsSummary.retryCount, '单')],
                    ['待审核', formatCountMetric(paymentsSummary, paymentsSummary.reviewOrders, '单')],
                    ['失败订单', formatCountMetric(paymentsSummary, paymentsSummary.failedOrders, '单')]
                ],
                actions: [
                    buildPaymentsAction({
                        label: '重试回调',
                        stateKey: 'payments-retry',
                        feedbackLabel: '回调重试',
                        intent: '打开支付运维页的待重试回调。',
                        defaultTab: 'ops',
                        issueSummary: 'retry',
                        focusTargetId: 'paymentsOpsAlertQueue',
                        primary: true
                    }),
                    buildPaymentsAction({
                        label: '查看订单',
                        stateKey: 'payments-orders',
                        feedbackLabel: '支付订单',
                        intent: '打开支付运维页的待复核订单。',
                        defaultTab: 'ops',
                        issueSummary: 'review',
                        focusTargetId: 'paymentsOrdersTable'
                    }),
                    buildPaymentsAction({
                        label: '打开日志',
                        stateKey: 'payments-logs',
                        feedbackLabel: '支付日志',
                        intent: '打开最近结账会话与支付日志。',
                        defaultTab: 'ops',
                        focusTargetId: 'paymentsCheckoutSessionsList'
                    })
                ],
                timeline: [
                    ['Callback', '订单 #A1029 回调等待重试', '刚刚', 'warn'],
                    ['Paid', '订单 #A1028 已入账', '3 分钟', 'ok'],
                    ['Audit', 'mock 支付开关未变更', '12 分钟', 'ok']
                ]
            },
            {
                id: 'inventory',
                label: '订单库存',
                stateLine: getInventoryStateLine(inventorySummary, counts.inventory),
                icon: 'fas fa-cube',
                tabClass: 'is-warn',
                badge: counts.inventory,
                badgeClass: 'is-warn',
                eyebrow: 'COMMERCE',
                title: '订单库存',
                subtitle: '把低库存、售罄和履约风险收成一条经营脉冲；正常波动不再占 Dock 视线。',
                priority: counts.inventory ? 'P2 观察' : (inventorySummary.ready ? '当前正常' : '同步中'),
                priorityClass: counts.inventory ? 'is-warn' : 'is-ok',
                route: '商品经营 / 库存预警',
                note: inventorySummary.status === 'error' && inventorySummary.lastMessage
                    ? inventorySummary.lastMessage
                    : '补货先回商城导入，订单异常回商城订单，活动调整再去券码或促销位；Dock 只挂真正需要处理的风险数。',
                metrics: [
                    ['低库存', formatCountMetric(inventorySummary, inventorySummary.lowStockCount, '个')],
                    ['售罄商品', formatCountMetric(inventorySummary, inventorySummary.soldOutCount, '个')],
                    ['履约风险', formatCountMetric(inventorySummary, inventorySummary.deliveryRiskProductCount, '项')]
                ],
                actions: [
                    {
                        label: '补货处理',
                        moduleId: 'shop',
                        stateKey: 'inventory-restock',
                        feedbackLabel: sanitizeText(inventoryRestockRecentItem?.feedbackLabel, 80) || '库存导入',
                        intent: sanitizeText(inventoryRestockRecentItem?.intent, 180) || '打开商城系统导入，直接处理补货。',
                        context: inventoryRestockContext,
                        options: inventoryRestockOptions,
                        primary: true
                    },
                    {
                        label: '异常订单',
                        moduleId: 'shop',
                        stateKey: 'inventory-orders',
                        feedbackLabel: '商城订单',
                        intent: '进入商城系统订单列表并定位异常单。',
                        context: {
                            destination: 'shop',
                            entity: 'shop-order',
                            action: 'open-orders',
                            payload: {
                                workspace: 'orders',
                                defaultTab: 'orders',
                                tab: 'orders'
                            }
                        },
                        options: {
                            defaultTab: 'orders',
                            tab: 'orders'
                        }
                    },
                    buildDiscountsAction({
                        label: '调整活动',
                        stateKey: 'inventory-discounts',
                        feedbackLabel: '优惠活动',
                        intent: '打开券码与优惠列表，继续调整库存相关活动。',
                        title: '库存相关活动调整',
                        referenceLabel: '处理动作',
                        referenceValue: '活动调整',
                        signalType: 'inventory'
                    })
                ],
                timeline: buildInventoryTimeline(inventorySummary)
            },
            {
                id: 'budget',
                label: 'AI 配置',
                stateLine: getAIPulseStateLine(aiSummary, counts.budget),
                icon: 'fas fa-atom',
                tabClass: 'is-ai',
                badge: counts.budget,
                badgeClass: aiSummary.lastResponseOk === false ? 'is-alert' : 'is-warn',
                eyebrow: 'AI RUNTIME',
                title: 'AI 配置与运行态',
                subtitle: '这里只显示真实配置、模型和最近运行态；没有日成本或预算数据源时，不再假装有占用图表。',
                priority: getAIPriorityLabel(aiSummary, counts.budget),
                priorityClass: getAIPriorityClass(aiSummary, counts.budget),
                route: '设置 / 通用 / AI 配置',
                note: getAINote(aiSummary),
                metrics: [
                    ['当前服务', formatTextMetric(aiSummary, aiSummary.configured ? (aiSummary.serviceLabel || aiSummary.service) : '未配置', '未配置')],
                    ['当前模型', formatTextMetric(aiSummary, aiSummary.configured ? aiSummary.model : '未配置', '未配置')],
                    ['输出上限', formatTokenMetric(aiSummary, aiSummary.maxOutputTokens)]
                ],
                actions: [
                    buildSettingsAction({
                        label: aiSummary.configured ? '检查配置' : '完成配置',
                        stateKey: 'budget-settings',
                        feedbackLabel: 'AI 配置',
                        intent: '打开通用设置中的 Codex Relay 配置入口。',
                        viewName: 'general',
                        focusTargetId: 'codexConfigPanel',
                        primary: true
                    }),
                    buildSettingsAction({
                        label: '查看服务',
                        stateKey: 'budget-usage',
                        feedbackLabel: 'AI 服务',
                        intent: '打开 AI 服务配置与当前接入状态。',
                        viewName: 'general',
                        focusTargetId: 'aiServiceDropdown'
                    }),
                    buildSettingsAction({
                        label: '查看模型',
                        stateKey: 'budget-fallback',
                        feedbackLabel: 'AI 路由',
                        intent: '打开 AI 服务选择入口，检查当前切换策略。',
                        viewName: 'general',
                        focusTargetId: 'aiServiceDropdown'
                    })
                ],
                timeline: buildAITimeline(aiSummary)
            },
            {
                id: 'security',
                label: '安全审计',
                stateLine: securitySummary.ready
                    ? (
                        counts.security
                            ? `${counts.security} 项异常`
                            : (securitySummary.anomalyCount > 0 ? `${securitySummary.anomalyCount} 条信号待核对` : '当前正常')
                    )
                    : '同步中',
                icon: 'fas fa-shield-alt',
                badge: counts.security,
                badgeClass: 'is-alert',
                eyebrow: 'SECURITY',
                title: '安全审计',
                subtitle: '管理员权限、异常登录、密钥代理和支付配置变更集中核对。',
                priority: counts.security
                    ? 'P1 安全异常'
                    : (securitySummary.anomalyCount > 0 ? '需核对异常信号' : '当前正常'),
                priorityClass: counts.security ? 'is-alert' : (securitySummary.anomalyCount > 0 ? 'is-warn' : 'is-ok'),
                route: '安全设置 / 审计与登录规则',
                note: 'Dock 只统计未关闭安全告警；异常登录信号和配置审计继续在面板里展示，不单独挂红点。',
                metrics: [
                    ['后台访问', formatCountMetric(securitySummary, securitySummary.accessCount, '次')],
                    ['异常信号', formatCountMetric(securitySummary, securitySummary.anomalyCount, '条')],
                    ['配置审计', formatCountMetric(securitySummary, securitySummary.configChangeCount, '条')]
                ],
                actions: [
                    buildSettingsAction({
                        label: '访问审计',
                        stateKey: 'security-audit',
                        feedbackLabel: '访问审计',
                        intent: '打开安全设置中的管理员访问审计。',
                        viewName: 'security',
                        workspace: 'admin-audit-monitor',
                        focusTargetId: 'adminAuditMonitorAccessCard',
                        primary: true
                    }),
                    buildSettingsAction({
                        label: '登录规则',
                        stateKey: 'security-login',
                        feedbackLabel: '登录规则',
                        intent: '定位到登录失败锁定与会话安全规则。',
                        viewName: 'security',
                        focusTargetId: 'cfgLoginLockoutAttempts'
                    }),
                    buildSettingsAction({
                        label: '导出日志',
                        stateKey: 'security-logs',
                        feedbackLabel: '安全日志',
                        intent: '打开安全审计配置列表，查看最近配置变更日志。',
                        viewName: 'security',
                        workspace: 'admin-audit-monitor',
                        focusTargetId: 'adminAuditMonitorConfigCard'
                    })
                ],
                timeline: [
                    ['Access', '2 位管理员 · 5 个 IP', '刚刚', 'ok'],
                    ['Audit', '支付配置审计 2 条', '12:46', 'ok'],
                    ['Key Proxy', '密钥代理状态正常', '12:42', 'ok']
                ]
            }
        ];
    }

    function getPulseItemsMap() {
        return buildPulseItems().reduce((map, item) => {
            map[item.id] = item;
            return map;
        }, {});
    }

    function getActivePulseItem() {
        const items = getPulseItemsMap();
        return items[state.activePulseId] || items.overview;
    }

    function renderPulseBadge(item = {}) {
        if (!item.badge) {
            return '';
        }
        return `<span class="admin-command-center__badge ${escapeHtml(item.badgeClass || '')}">${escapeHtml(item.badge)}</span>`;
    }

    function renderDockIcon(item = {}) {
        return `<i class="${escapeHtml(item.icon || 'fas fa-circle')}" aria-hidden="true"></i>`;
    }

    function renderDockIconStyle(pulseId = '') {
        const lift = state.dockLiftByPulseId?.[sanitizeText(pulseId, 80)];
        if (!lift || typeof lift !== 'object') {
            return '';
        }
        return [
            `--admin-command-dock-scale:${lift.scale}`,
            `--admin-command-dock-rise:${lift.rise}`,
            `--admin-command-dock-border:${lift.border}`,
            `--admin-command-dock-bg:${lift.bg}`
        ].join(';');
    }

    function renderPulseDock(items = []) {
        return items.map((item) => {
            const dockIconStyle = renderDockIconStyle(item.id);
            return `
                <button class="admin-command-center__dock-btn ${escapeHtml(item.tabClass || '')}${item.id === state.activePulseId && state.panelPhase !== 'closed' ? ' is-engaged' : ''}" type="button" data-admin-command-pulse="${escapeHtml(item.id)}" aria-selected="${item.id === state.activePulseId ? 'true' : 'false'}" aria-label="${escapeHtml(`${item.label} ${item.stateLine}`)}">
                    <span class="admin-command-center__dock-icon"${dockIconStyle ? ` style="${escapeHtml(dockIconStyle)}"` : ''}>${renderDockIcon(item)}</span>
                    ${renderPulseBadge(item)}
                    <span class="admin-command-center__dock-label">
                        <span>${escapeHtml(item.label)}</span>
                        <small>${escapeHtml(item.stateLine)}</small>
                    </span>
                </button>
            `;
        }).join('');
    }

    function renderPulseMetrics(item = {}) {
        return (item.metrics || []).map(([label, value]) => `
            <article class="admin-command-center__metric-card">
                <span>${escapeHtml(label)}</span>
                <strong>${escapeHtml(value)}</strong>
            </article>
        `).join('');
    }

    function renderPulseActions(item = {}) {
        return (item.actions || []).map((action, index) => {
            const moduleId = normalizeModuleId(action.moduleId || '');
            const stateKey = normalizeActionStateKey(action.stateKey || `${item.id}-${moduleId || 'intent'}-${index}`);
            const actionState = moduleId ? getQuickActionState(stateKey, moduleId) : 'ready';
            const hasState = moduleId && actionState !== 'ready';
            const isLoading = actionState === 'loading';
            const stateLabel = getFeedbackStateLabel(actionState);
            const contextAttr = serializeDataObject(action.context);
            const optionsAttr = serializeDataObject(action.options);
            const feedbackLabel = sanitizeText(action.feedbackLabel, 80);
            return `
                <button class="admin-command-center__quick-btn${action.primary ? ' is-primary' : ''}${hasState ? ` is-${escapeHtml(actionState)} has-state` : ''}" type="button" ${moduleId ? `data-admin-command-module="${escapeHtml(moduleId)}" data-admin-command-state-key="${escapeHtml(stateKey)}" data-admin-command-state="${escapeHtml(actionState)}"` : ''}${contextAttr ? ` data-admin-command-context="${contextAttr}"` : ''}${optionsAttr ? ` data-admin-command-options="${optionsAttr}"` : ''}${feedbackLabel ? ` data-admin-command-feedback-label="${escapeHtml(feedbackLabel)}"` : ''} data-admin-command-intent="${escapeHtml(action.intent || '')}" aria-busy="${isLoading ? 'true' : 'false'}"${isLoading ? ' disabled' : ''}>
                    <span>${escapeHtml(action.label)}</span>
                    <small class="admin-command-center__quick-state" aria-hidden="true">${escapeHtml(stateLabel)}</small>
                </button>
            `;
        }).join('');
    }

    function renderPulseTimeline(item = {}) {
        return normalizePulseTimelineRows(getRealtimePulseTimeline(item), item).map((row, index) => {
            const moduleId = normalizeModuleId(row.moduleId || '');
            const toneClass = row.tone ? ` is-${escapeHtml(row.tone)}` : '';
            if (!moduleId) {
                return `
                    <article class="admin-command-center__timeline-item${toneClass}">
                        <span class="admin-command-center__timeline-dot" aria-hidden="true"></span>
                        <div class="admin-command-center__timeline-main">
                            <strong>${escapeHtml(row.label)}</strong>
                            <small>${escapeHtml(row.copy)}</small>
                        </div>
                        <time>${escapeHtml(row.timeLabel || '刚同步')}</time>
                    </article>
                `;
            }

            const stateKey = normalizeActionStateKey(row.stateKey || `${item.id}-${moduleId}-recent-${index}`);
            const actionState = getQuickActionState(stateKey, moduleId);
            const hasState = actionState !== 'ready';
            const isLoading = actionState === 'loading';
            const contextAttr = serializeDataObject(row.context);
            const optionsAttr = serializeDataObject(row.options);
            const feedbackLabel = sanitizeText(row.feedbackLabel || row.label, 80);
            return `
                <button class="admin-command-center__timeline-item admin-command-center__timeline-item--action${toneClass}${hasState ? ` is-${escapeHtml(actionState)} has-state` : ''}" type="button" data-admin-command-module="${escapeHtml(moduleId)}" data-admin-command-state-key="${escapeHtml(stateKey)}" data-admin-command-state="${escapeHtml(actionState)}"${contextAttr ? ` data-admin-command-context="${contextAttr}"` : ''}${optionsAttr ? ` data-admin-command-options="${optionsAttr}"` : ''}${feedbackLabel ? ` data-admin-command-feedback-label="${escapeHtml(feedbackLabel)}"` : ''} data-admin-command-intent="${escapeHtml(row.intent || '')}" aria-label="${escapeHtml(`打开 ${feedbackLabel || row.label}`)}" aria-busy="${isLoading ? 'true' : 'false'}"${isLoading ? ' disabled' : ''}>
                    <span class="admin-command-center__timeline-dot" aria-hidden="true"></span>
                    <span class="admin-command-center__timeline-main">
                        <strong>${escapeHtml(row.label)}</strong>
                        <small>${escapeHtml(row.copy)}</small>
                    </span>
                    <time>${escapeHtml(row.timeLabel || '刚同步')}</time>
                </button>
            `;
        }).join('');
    }

    function renderPulsePanel(item = {}) {
        const panelPhase = sanitizeText(state.panelPhase, 20) || 'closed';
        const panelStyle = getPanelMotionStyle(state.panelMotion);
        return `
            <section class="admin-command-center__panel is-${escapeHtml(panelPhase)}" id="adminCommandCenterPanel" aria-live="polite" aria-hidden="${panelPhase === 'closed' ? 'true' : 'false'}"${panelStyle ? ` style="${escapeHtml(panelStyle)}"` : ''}>
                <header class="admin-command-center__panel-head">
                    <span class="admin-command-center__eyebrow">${escapeHtml(item.eyebrow)}</span>
                    <h2 class="admin-command-center__title">${escapeHtml(item.title)}</h2>
                    <p>${escapeHtml(item.subtitle)}</p>
                </header>
                <div class="admin-command-center__panel-body">
                    <div class="admin-command-center__summary">
                        <span class="admin-command-center__priority ${escapeHtml(item.priorityClass || '')}">${escapeHtml(item.priority)}</span>
                        <span class="admin-command-center__route">${escapeHtml(item.route)}</span>
                    </div>
                    <div class="admin-command-center__metrics">${renderPulseMetrics(item)}</div>
                    <p class="admin-command-center__note">${escapeHtml(item.note)}</p>
                    <div class="admin-command-center__quick">${renderPulseActions(item)}</div>
                    <div class="admin-command-center__toast">${escapeHtml(state.actionToast || item.actions?.[0]?.intent || item.route)}</div>
                    <h3 class="admin-command-center__timeline-title"><i class="fas fa-clock" aria-hidden="true"></i> 即时记录</h3>
                    <div class="admin-command-center__timeline">${renderPulseTimeline(item)}</div>
                    <div class="admin-command-center__panel-actions">
                        <button class="admin-command-center__nav-btn" type="button" data-admin-command-step="-1">上一项</button>
                        <button class="admin-command-center__nav-btn is-primary" type="button" data-admin-command-step="1">下一项</button>
                    </div>
                </div>
            </section>
        `;
    }

    function syncPanelPhaseDom(root = getRoot()) {
        if (!root) {
            return;
        }
        const panelPhase = sanitizeText(state.panelPhase, 20) || 'closed';
        root.classList?.toggle?.('is-open', panelPhase === 'open');
        root.classList?.toggle?.('is-panel-visible', panelPhase !== 'closed');
        root.classList?.toggle?.('is-opening', panelPhase === 'opening');
        root.classList?.toggle?.('is-closing', panelPhase === 'closing');
        if (root.dataset) {
            root.dataset.panelPhase = panelPhase;
        }

        const panel = typeof root.querySelector === 'function'
            ? root.querySelector('.admin-command-center__panel')
            : null;
        if (panel?.classList?.toggle) {
            panel.classList.toggle('is-open', panelPhase === 'open');
            panel.classList.toggle('is-opening', panelPhase === 'opening');
            panel.classList.toggle('is-closing', panelPhase === 'closing');
            panel.classList.toggle('is-closed', panelPhase === 'closed');
        }
        panel?.setAttribute?.('aria-hidden', panelPhase === 'closed' ? 'true' : 'false');

        if (typeof root.querySelectorAll !== 'function') {
            return;
        }
        root.querySelectorAll('.admin-command-center__dock-btn').forEach((button) => {
            button.classList?.toggle?.(
                'is-engaged',
                button.dataset?.adminCommandPulse === state.activePulseId && panelPhase !== 'closed'
            );
        });
    }

    function render() {
        const root = ensureRoot();
        if (!root) {
            return;
        }

        state.activeModuleId = getActiveModuleId();
        state.site = getCurrentSite();
        const pulseItems = buildPulseItems();
        if (!pulseItems.some((item) => item.id === state.activePulseId)) {
            state.activePulseId = 'overview';
        }
        const activeItem = getActivePulseItem();

        root.innerHTML = `
            <div class="admin-command-center__dock" aria-label="运营待处理">
                ${renderPulseDock(pulseItems)}
            </div>
            ${renderPulsePanel(activeItem)}
        `;
        syncPanelPhaseDom(root);
        reapplyDockLift(root);
    }

    function mergeQuickActionContext(context = {}, patch = {}) {
        const normalizedContext = context && typeof context === 'object' && !Array.isArray(context) ? context : {};
        const normalizedPatch = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
        const contextPayload = normalizedContext.payload && typeof normalizedContext.payload === 'object' ? normalizedContext.payload : {};
        const patchPayload = normalizedPatch.payload && typeof normalizedPatch.payload === 'object' ? normalizedPatch.payload : {};

        return {
            ...normalizedContext,
            ...normalizedPatch,
            payload: {
                ...contextPayload,
                ...patchPayload
            }
        };
    }

    function resolveQuickActionHelper(moduleId, context = {}, helperOptions = {}) {
        const normalizedModuleId = normalizeModuleId(moduleId);
        const openWorkbenchHelper = window.openAdminWorkbenchEntry || window.openOpsAlertWorkspace || null;
        if (normalizedModuleId === 'ops-workspace' && typeof openWorkbenchHelper === 'function') {
            const workspaceKey = sanitizeText(
                helperOptions.workspaceKey
                || context.workspaceKey
                || context.payload?.workspaceKey
                || context.raw?.workspaceKey,
                120
            ).toLowerCase();
            if (!workspaceKey) {
                return null;
            }
            return () => openWorkbenchHelper(workspaceKey, context);
        }

        if (normalizedModuleId === 'settings' && typeof window.openAdminSettingsShellContext === 'function') {
            return () => window.openAdminSettingsShellContext(context, {
                viewName: 'security',
                settingsView: 'security',
                ...helperOptions
            });
        }

        if (normalizedModuleId === 'ops-alerts' && typeof window.openAdminOpsAlertsShellContext === 'function') {
            return () => window.openAdminOpsAlertsShellContext(
                mergeQuickActionContext({
                    payload: {
                        view: 'overview'
                    }
                }, context),
                {
                    viewName: 'overview',
                    ...helperOptions
                }
            );
        }

        const helperConfig = QUICK_ACTION_HELPERS[normalizedModuleId];
        const helper = helperConfig?.helperName && typeof window[helperConfig.helperName] === 'function'
            ? window[helperConfig.helperName]
            : null;
        if (typeof helper === 'function') {
            return () => helper(
                mergeQuickActionContext(helperConfig.context, context),
                {
                    ...(helperConfig.options || {}),
                    ...helperOptions
                }
            );
        }

        return null;
    }

    function emitQuickActionFeedback(moduleId, feedbackState = 'ready', message = '') {
        const normalizedModuleId = normalizeModuleId(moduleId);
        const feedbackMessage = sanitizeText(message, 180);
        if (!feedbackMessage) {
            return;
        }

        window.dispatchEvent(new CustomEvent('admin-feedback-signal', {
            detail: {
                source: 'command-center',
                state: feedbackState,
                module: normalizedModuleId,
                message: feedbackMessage,
                pulseId: state.activePulseId,
                timestamp: Date.now()
            }
        }));
    }

    function activateQuickModuleForHelper(moduleId, context = {}, helperOptions = {}) {
        const normalizedModuleId = normalizeModuleId(moduleId);
        if (!normalizedModuleId) {
            return false;
        }

        if (normalizedModuleId === 'ops-workspace') {
            return true;
        }

        if (typeof window.AdminShell?.activateModule === 'function') {
            return window.AdminShell.activateModule(normalizedModuleId, {
                ...helperOptions,
                context,
                deferContext: true,
                reason: 'command-center-helper-fallback'
            }) !== false;
        }

        return true;
    }

    async function openQuickModule(moduleId, actionConfig = {}) {
        const action = QUICK_ACTIONS.find((item) => item.moduleId === moduleId);
        const normalizedModuleId = normalizeModuleId(moduleId);
        const contextPatch = actionConfig.context && typeof actionConfig.context === 'object' ? actionConfig.context : {};
        const helperOptions = actionConfig.options && typeof actionConfig.options === 'object' ? actionConfig.options : {};
        const stateKey = normalizeActionStateKey(actionConfig.stateKey || normalizedModuleId);
        const moduleLabel = sanitizeText(actionConfig.feedbackLabel, 80) || getModuleLabel(normalizedModuleId);
        const baseContext = {
            source: state.activeModuleId || getActiveModuleId(),
            destination: normalizedModuleId || moduleId,
            reason: 'command-center'
        };
        const hasActionContext = Boolean(
            (action?.context && Object.keys(action.context).length)
            || Object.keys(contextPatch).length
        );
        const context = hasActionContext
            ? mergeQuickActionContext(mergeQuickActionContext(baseContext, action?.context || {}), contextPatch)
            : baseContext;

        emitQuickActionFeedback(normalizedModuleId, 'loading', `${moduleLabel} 正在打开`);
        setQuickActionState(stateKey, normalizedModuleId, 'loading');

        try {
            if (window.AdminShell?.openContext) {
                const opened = await window.AdminShell.openContext(normalizedModuleId, context, {
                    settleMs: 100
                });
                if (opened) {
                    setQuickActionState(stateKey, normalizedModuleId, 'saved');
                    emitQuickActionFeedback(normalizedModuleId, 'saved', `${moduleLabel} 已打开`);
                    return true;
                }
            }

            const helper = resolveQuickActionHelper(normalizedModuleId, context, helperOptions);
            if (typeof helper === 'function') {
                const activated = activateQuickModuleForHelper(normalizedModuleId, context, helperOptions);
                if (activated !== false) {
                    const opened = await helper();
                    if (opened !== false) {
                        setQuickActionState(stateKey, normalizedModuleId, 'saved');
                        emitQuickActionFeedback(normalizedModuleId, 'saved', `${moduleLabel} 已打开`);
                        return true;
                    }
                }
            }

            const switched = typeof window.switchModule === 'function'
                ? window.switchModule(normalizedModuleId, {
                    ...helperOptions,
                    context,
                    reason: 'command-center'
                }) !== false
                : false;
            emitQuickActionFeedback(
                normalizedModuleId,
                switched ? 'saved' : 'failed',
                switched ? `${moduleLabel} 已打开` : `${moduleLabel} 打开失败，请从侧边栏重试`
            );
            setQuickActionState(stateKey, normalizedModuleId, switched ? 'saved' : 'failed');
            return switched;
        } catch (error) {
            console.warn('[AdminCommandCenter] Quick action failed:', error);
            setQuickActionState(stateKey, normalizedModuleId, 'failed');
            emitQuickActionFeedback(normalizedModuleId, 'failed', `${moduleLabel} 打开失败，请从侧边栏重试`);
            return false;
        }
    }

    function getDockLiftVars(intensity = 0, options = {}) {
        const eased = intensity * intensity * (3 - 2 * intensity);
        const scaleBoost = Number.isFinite(options.scaleBoost) ? options.scaleBoost : 0.44;
        const riseDistance = Number.isFinite(options.riseDistance) ? options.riseDistance : 16;
        return {
            scale: (1 + eased * scaleBoost).toFixed(3),
            rise: `${(eased * riseDistance).toFixed(1)}px`,
            border: (0.08 + eased * 0.44).toFixed(3),
            bg: (0.045 + eased * 0.065).toFixed(3)
        };
    }

    function setDockIconLift(icon, intensity = 0, options = {}, pulseId = '') {
        const lift = getDockLiftVars(intensity, options);
        const normalizedPulseId = sanitizeText(pulseId, 80);
        if (normalizedPulseId) {
            state.dockLiftByPulseId[normalizedPulseId] = lift;
        }
        if (!icon?.style?.setProperty) {
            return;
        }
        icon.style.setProperty('--admin-command-dock-scale', lift.scale);
        icon.style.setProperty('--admin-command-dock-rise', lift.rise);
        icon.style.setProperty('--admin-command-dock-border', lift.border);
        icon.style.setProperty('--admin-command-dock-bg', lift.bg);
    }

    function clearDockLift(root = getRoot()) {
        state.dockLiftByPulseId = {};
        if (typeof root?.querySelectorAll !== 'function') {
            return;
        }
        root.querySelectorAll('.admin-command-center__dock-icon').forEach((icon) => {
            icon.style.removeProperty('--admin-command-dock-scale');
            icon.style.removeProperty('--admin-command-dock-rise');
            icon.style.removeProperty('--admin-command-dock-border');
            icon.style.removeProperty('--admin-command-dock-bg');
        });
    }

    function updateDockLiftForDock(root = getRoot(), dock = null, clientX = 0, clientY = 0) {
        if (
            typeof root?.querySelectorAll !== 'function'
            || typeof dock?.querySelectorAll !== 'function'
            || typeof clientX !== 'number'
            || typeof clientY !== 'number'
        ) {
            return;
        }
        const buttons = [...dock.querySelectorAll('.admin-command-center__dock-btn')];
        if (!buttons.length) {
            return;
        }
        const dockRect = dock.getBoundingClientRect?.();
        const isHorizontalDock = Boolean(dockRect && dockRect.width > dockRect.height);
        const influence = isHorizontalDock ? 92 : 98;
        const motionProfile = isHorizontalDock
            ? { scaleBoost: 0.26, riseDistance: 9 }
            : { scaleBoost: 0.44, riseDistance: 16 };
        buttons.forEach((button) => {
            const icon = button.querySelector?.('.admin-command-center__dock-icon');
            const rect = button.getBoundingClientRect?.();
            if (!icon || !rect) {
                return;
            }
            const center = isHorizontalDock
                ? rect.left + rect.width / 2
                : rect.top + rect.height / 2;
            const pointer = isHorizontalDock ? clientX : clientY;
            const distance = Math.min(Math.abs(pointer - center), influence);
            const intensity = (1 + Math.cos((distance / influence) * Math.PI)) / 2;
            setDockIconLift(icon, intensity, motionProfile, button.dataset?.adminCommandPulse);
        });
    }

    function updateDockLift(root = getRoot(), event = {}) {
        if (
            typeof root?.querySelectorAll !== 'function'
            || typeof event.clientX !== 'number'
            || typeof event.clientY !== 'number'
        ) {
            return;
        }
        const dock = event.target?.closest?.('.admin-command-center__dock');
        if (!dock || typeof dock.querySelectorAll !== 'function') {
            state.dockPointer.active = false;
            clearDockLift(root);
            return;
        }
        state.dockPointer.active = true;
        state.dockPointer.clientX = event.clientX;
        state.dockPointer.clientY = event.clientY;
        updateDockLiftForDock(root, dock, event.clientX, event.clientY);
    }

    function reapplyDockLift(root = getRoot()) {
        if (!state.dockPointer.active || typeof root?.querySelector !== 'function') {
            return;
        }
        const dock = root.querySelector('.admin-command-center__dock');
        if (!dock) {
            return;
        }
        updateDockLiftForDock(root, dock, state.dockPointer.clientX, state.dockPointer.clientY);
    }

    function bindRoot(root) {
        if (!root || root.dataset.commandCenterBound === '1') {
            return;
        }

        root.dataset.commandCenterBound = '1';
        root.addEventListener('click', (event) => {
            const pulseButton = event.target.closest('[data-admin-command-pulse]');
            if (pulseButton) {
                if (typeof event.clientX === 'number' && typeof event.clientY === 'number') {
                    const dock = pulseButton.closest?.('.admin-command-center__dock');
                    state.dockPointer.active = true;
                    state.dockPointer.clientX = event.clientX;
                    state.dockPointer.clientY = event.clientY;
                    updateDockLiftForDock(root, dock, event.clientX, event.clientY);
                }
                state.actionToast = '选择一个入口，直接回到对应页面处理。';
                openPanel(sanitizeText(pulseButton.dataset.adminCommandPulse, 80) || 'overview', pulseButton);
                return;
            }

            const stepButton = event.target.closest('[data-admin-command-step]');
            if (stepButton) {
                const items = buildPulseItems();
                const currentIndex = Math.max(0, items.findIndex((item) => item.id === state.activePulseId));
                const direction = Number(stepButton.dataset.adminCommandStep) || 1;
                const nextIndex = (currentIndex + direction + items.length) % items.length;
                state.activePulseId = items[nextIndex]?.id || 'overview';
                state.panelOpen = true;
                state.panelPhase = 'open';
                state.actionToast = '选择一个入口，直接回到对应页面处理。';
                render();
                return;
            }

            const quickButton = event.target.closest('[data-admin-command-module]');
            if (quickButton) {
                const intent = sanitizeText(quickButton.dataset.adminCommandIntent, 180);
                if (intent) {
                    state.actionToast = intent;
                    render();
                }
                void openQuickModule(sanitizeText(quickButton.dataset.adminCommandModule, 120), {
                    stateKey: sanitizeText(quickButton.dataset.adminCommandStateKey, 120),
                    feedbackLabel: sanitizeText(quickButton.dataset.adminCommandFeedbackLabel, 80),
                    context: parseDataObject(quickButton.dataset.adminCommandContext),
                    options: parseDataObject(quickButton.dataset.adminCommandOptions)
                });
                return;
            }

            const intentButton = event.target.closest('[data-admin-command-intent]');
            if (intentButton) {
                state.actionToast = sanitizeText(intentButton.dataset.adminCommandIntent, 180) || state.actionToast;
                render();
            }
        });

        root.addEventListener('pointermove', (event) => {
            updateDockLift(root, event);
        });
        root.addEventListener('pointerleave', () => {
            state.dockPointer.active = false;
            clearDockLift(root);
        });
    }

    function rememberContext(context = {}, detail = {}) {
        const normalizedContext = context && typeof context === 'object' && !Array.isArray(context) ? context : {};
        const source = normalizeModuleId(normalizedContext.source);
        const destination = normalizeModuleId(normalizedContext.destination);
        if (!destination) {
            return;
        }
        const delivery = detail?.delivery && typeof detail.delivery === 'object' ? detail.delivery : {};
        const status = sanitizeText(delivery.status || (delivery.handled === false ? 'unhandled' : 'delivered'), 40).toLowerCase();

        const nextItem = {
            source: source || state.activeModuleId || 'admin',
            destination,
            action: sanitizeText(normalizedContext.action || normalizedContext.raw?.action || normalizedContext.payload?.action, 120),
            entity: sanitizeText(normalizedContext.entity || normalizedContext.raw?.entity || normalizedContext.payload?.entity, 80),
            focusLabel: buildContextFocusLabel(normalizedContext),
            status: status || 'delivered',
            site: sanitizeText(normalizedContext.site || getCurrentSite(), 20).toLowerCase() || 'all',
            at: Number(delivery.at || Date.now()) || Date.now()
        };
        const latest = state.contextTrail[0];
        if (latest
            && latest.source === nextItem.source
            && latest.destination === nextItem.destination
            && latest.action === nextItem.action
            && latest.focusLabel === nextItem.focusLabel) {
            state.contextTrail[0] = nextItem;
        } else {
            state.contextTrail.unshift(nextItem);
        }
        state.contextTrail = state.contextTrail.slice(0, 5);
        return nextItem;
    }

    function bindEvents() {
        document.addEventListener('pointerdown', (event) => {
            const root = getRoot();
            if (!state.panelOpen || !root?.contains || root.contains(event.target)) {
                return;
            }
            closePanel();
        });

        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape' || !state.panelOpen) {
                return;
            }
            closePanel();
        });

        window.addEventListener('admin-shell-module-activated', (event) => {
            state.activeModuleId = normalizeModuleId(event.detail?.moduleId || state.activeModuleId);
            state.lastSignal = `${getModuleLabel(state.activeModuleId)} 已就绪`;
            render();
        });

        window.addEventListener('admin-shell-context', (event) => {
            rememberContext(event.detail?.context || {}, event.detail || {});
            state.lastSignal = '联动上下文已送达';
            render();
        });

        window.addEventListener('admin-shell-site-changed', (event) => {
            state.site = sanitizeText(event.detail?.site || getCurrentSite(), 20).toLowerCase() || 'all';
            state.lastSignal = `${state.site.toUpperCase()} 视图`;
            syncPulseSummaries();
            render();
            void primePulseSummaries({ force: true });
            scheduleDeferredPulseSummaries({ force: true });
        });

        window.addEventListener('admin-site-changed', (event) => {
            state.site = sanitizeText(event.detail?.site || getCurrentSite(), 20).toLowerCase() || 'all';
            syncPulseSummaries();
            render();
            void primePulseSummaries({ force: true });
            scheduleDeferredPulseSummaries({ force: true });
        });

        window.addEventListener('admin-ai-budget', (event) => {
            state.aiService = sanitizeText(event.detail?.service || window.AdminAI?.getPreferredService?.() || '', 80);
            state.aiBudget = event.detail?.budget || null;
            state.aiStatus = state.aiService ? `${window.AdminAI?.getServiceLabel?.(state.aiService) || state.aiService} 预算锁定` : '预算锁定';
            applyAISummary(getRuntimeAISummary(), { render: false });
            render();
        });

        window.addEventListener('admin-ai-response', (event) => {
            state.aiBudget = event.detail?.budget || state.aiBudget;
            state.lastLatencyMs = Number(event.detail?.durationMs) || 0;
            state.aiStatus = event.detail?.ok === false ? 'AI 请求失败' : 'AI 完成';
            applyAISummary(getRuntimeAISummary(), { render: false });
            render();
        });

        window.addEventListener('admin-feedback-signal', (event) => {
            rememberFeedbackSignal(event.detail || {});
            render();
        });

        window.addEventListener('admin-chat-command-summary-updated', (event) => {
            applyNotificationsSummary(event.detail || {});
        });

        window.addEventListener('admin-payments-command-summary-updated', (event) => {
            applyPaymentsSummary(event.detail || {});
        });

        window.addEventListener('admin-analytics-inventory-summary-updated', (event) => {
            applyInventorySummary(event.detail || {});
        });

        window.addEventListener('admin-ai-command-summary-updated', (event) => {
            applyAISummary(event.detail || {});
        });

        window.addEventListener('admin-audit-command-summary-updated', (event) => {
            applySecuritySummary(event.detail || {});
        });
    }

    function init() {
        state.collapsed = readCollapsedState();
        state.activeModuleId = getActiveModuleId();
        state.site = getCurrentSite();
        state.aiService = sanitizeText(window.AdminAI?.getPreferredService?.() || '', 80);
        syncPulseSummaries();
        bindEvents();
        render();
        markCommandCenterTimingOnce('first-render', {
            activeModuleId: state.activeModuleId,
            site: state.site
        });
        void primePulseSummaries();
        scheduleDeferredPulseSummaries();
    }

    window.AdminCommandCenter = {
        version: VERSION,
        init,
        render,
        recordContext: rememberContext,
        recordFeedbackSignal: rememberFeedbackSignal,
        setSecurityStatus(value) {
            state.securityStatus = sanitizeText(value, 120) || state.securityStatus;
            render();
        },
        getState() {
            return {
                ...state,
                contextTrail: [...state.contextTrail]
            };
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
