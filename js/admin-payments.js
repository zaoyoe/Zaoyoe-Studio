(function () {
    'use strict';

    const state = {
        initialized: false,
        initializing: false,
        loading: false,
        cleanupLoading: false,
        days: 30,
        rangeMode: 'preset',
        customStartDate: null,
        customEndDate: null,
        activeTab: 'overview',
        listenersBound: false,
        summary: null,
        cleanupPreview: null,
        requestToken: 0,
        initPromise: null,
        viewCache: {},
        overviewStage: 'idle',
        overviewSecondaryLoaded: false,
        overviewOpsLoaded: false,
        lastSyncedAt: null,
        autoRefreshEnabled: true,
        autoRefreshIntervalMs: 5 * 60 * 1000,
        autoRefreshTimer: null,
        anomalyActionLoading: {},
        batchAnomalyActionLoading: {},
        businessBreakdownFocusKey: 'all',
        businessBreakdownHoverIndex: null,
        pointsBreakdownFocusKey: 'all',
        pointsBreakdownHoverIndex: null,
        exceptionTopicFilter: 'all',
        focusOrderId: '',
        lastFocusResult: null,
        tabPrefetchHandle: 0,
        tabPrefetchMode: '',
        tabPrefetchTaskKey: '',
        tabPrefetchPromise: null,
        commandCenterPrimeKey: '',
        commandCenterPrimePromise: null,
        issueSummaryFocus: '',
        workbenchContext: null,
        pagination: {
            anomalies: 1,
            sessions: 1,
            orders: 1,
            cleanupOrders: 1,
            cleanupUsers: 1
        }
    };

    const PAYMENTS_PAGE_SIZE = 5;
    const PAYMENTS_TABS = new Set(['overview', 'finance', 'ops']);
    const PAYMENTS_PREFETCH_TABS = [];
    const NOTE_REQUIRED_ACTIONS = new Set([
        'approve_review',
        'reject_review',
        'approve_amount_mismatch',
        'reject_amount_mismatch',
        'refund_hupijiao',
        'reconcile_hupijiao_order',
        'refund_zpay',
        'reconcile_zpay_order',
        'refund_nowpayments'
    ]);
    const CLEANUP_SCOPE_HTML = '只会清理订单号前缀为 <code>AUTO_CDX_*</code> 或 <code>SMOKE_*</code> 的测试订单，以及邮箱匹配 <code>codex.*@example.com</code> 或 <code>smoke-payment-*@zaoyoe.invalid</code> 的测试账号。';
    const CLEANUP_SCOPE_TEXT = '将删除 AUTO_CDX_* / SMOKE_* 测试订单，以及 codex.*@example.com / smoke-payment-*@zaoyoe.invalid 测试账号。此操作不可撤销，是否继续？';
    const REFUND_TOPIC_ORDER = ['refund_compensation_failures', 'refund_reclaim_failures', 'refund_failures'];
    const REFUND_TOPIC_KEY_SET = new Set(REFUND_TOPIC_ORDER);
    const PAYMENT_INTENT_EXCEPTION_TOPIC_KEYS = [
        'checkout_unlinked',
        'checkout_session_failed',
        'checkout_session_stale',
        'checkout_session_unlinked',
        'payment_intent_failed',
        'payment_intent_stale',
        'payment_intent_unlinked'
    ];
    const PAYMENT_INTENT_EXCEPTION_TOPIC_KEY_SET = new Set(PAYMENT_INTENT_EXCEPTION_TOPIC_KEYS);
    const CALLBACK_EXCEPTION_TOPIC_KEYS = new Set([
        ...PAYMENT_INTENT_EXCEPTION_TOPIC_KEYS,
        'session_anomalies'
    ]);
    const RESOLVED_ANOMALY_STATUSES = new Set(['handled', 'ignored', 'approved', 'rejected', 'archived']);
    const ACTIVE_OPS_ALERT_STATUSES = new Set(['pending', 'retry', 'processing', 'dead_letter']);
    const BUSINESS_BREAKDOWN_TONE_META = {
        recharge: {
            icon: 'fas fa-wallet',
            color: '#38cfff',
            fill: 'rgba(56, 207, 255, 0.18)',
            glow: 'rgba(56, 207, 255, 0.26)'
        },
        shop: {
            icon: 'fas fa-store',
            color: '#45e6a8',
            fill: 'rgba(69, 230, 168, 0.17)',
            glow: 'rgba(69, 230, 168, 0.22)'
        },
        profit: {
            icon: 'fas fa-scale-balanced',
            color: '#f59e0b',
            fill: 'rgba(245, 158, 11, 0.17)',
            glow: 'rgba(245, 158, 11, 0.24)'
        },
        mock: {
            icon: 'fas fa-flask',
            color: '#b56cff',
            fill: 'rgba(181, 108, 255, 0.18)',
            glow: 'rgba(181, 108, 255, 0.24)'
        },
        balance: {
            icon: 'fas fa-coins',
            color: '#ffb84d',
            fill: 'rgba(255, 184, 77, 0.18)',
            glow: 'rgba(255, 184, 77, 0.24)'
        },
        all: {
            icon: 'fas fa-chart-line',
            color: '#7dd3fc',
            fill: 'rgba(125, 211, 252, 0.15)',
            glow: 'rgba(125, 211, 252, 0.2)'
        }
    };
    const POINTS_BREAKDOWN_TONE_META = {
        recharge: {
            icon: 'fas fa-wallet',
            color: '#38cfff',
            fill: 'rgba(56, 207, 255, 0.18)',
            glow: 'rgba(56, 207, 255, 0.24)'
        },
        redeem_code: {
            icon: 'fas fa-ticket',
            color: '#7dd3fc',
            fill: 'rgba(125, 211, 252, 0.16)',
            glow: 'rgba(125, 211, 252, 0.2)'
        },
        rewards: {
            icon: 'fas fa-gift',
            color: '#45e6a8',
            fill: 'rgba(69, 230, 168, 0.16)',
            glow: 'rgba(69, 230, 168, 0.2)'
        },
        refund: {
            icon: 'fas fa-rotate-left',
            color: '#9ee6ff',
            fill: 'rgba(158, 230, 255, 0.15)',
            glow: 'rgba(158, 230, 255, 0.18)'
        },
        admin_in: {
            icon: 'fas fa-user-shield',
            color: '#c4b5fd',
            fill: 'rgba(196, 181, 253, 0.16)',
            glow: 'rgba(196, 181, 253, 0.2)'
        },
        shop_purchase: {
            icon: 'fas fa-store',
            color: '#ffb84d',
            fill: 'rgba(255, 184, 77, 0.17)',
            glow: 'rgba(255, 184, 77, 0.22)'
        },
        content_unlock: {
            icon: 'fas fa-unlock',
            color: '#f472b6',
            fill: 'rgba(244, 114, 182, 0.16)',
            glow: 'rgba(244, 114, 182, 0.2)'
        },
        verification: {
            icon: 'fas fa-shield-halved',
            color: '#fb7185',
            fill: 'rgba(251, 113, 133, 0.16)',
            glow: 'rgba(251, 113, 133, 0.2)'
        },
        refund_out: {
            icon: 'fas fa-arrow-rotate-left',
            color: '#fca5a5',
            fill: 'rgba(252, 165, 165, 0.15)',
            glow: 'rgba(252, 165, 165, 0.18)'
        },
        admin_deduct: {
            icon: 'fas fa-minus-circle',
            color: '#fdba74',
            fill: 'rgba(253, 186, 116, 0.15)',
            glow: 'rgba(253, 186, 116, 0.18)'
        },
        other_in: {
            icon: 'fas fa-plus',
            color: '#a7f3d0',
            fill: 'rgba(167, 243, 208, 0.14)',
            glow: 'rgba(167, 243, 208, 0.16)'
        },
        other_out: {
            icon: 'fas fa-minus',
            color: '#f9a8d4',
            fill: 'rgba(249, 168, 212, 0.14)',
            glow: 'rgba(249, 168, 212, 0.16)'
        },
        all: {
            icon: 'fas fa-chart-line',
            color: '#bde7ff',
            fill: 'rgba(189, 231, 255, 0.14)',
            glow: 'rgba(189, 231, 255, 0.16)'
        }
    };

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatNumber(value) {
        const num = Number(value || 0);
        return Number.isFinite(num) ? num.toLocaleString('zh-CN') : '0';
    }

    function formatCurrency(value) {
        const num = Number(value || 0);
        return Number.isFinite(num)
            ? `¥${num.toLocaleString('zh-CN', { minimumFractionDigits: num % 1 ? 2 : 0, maximumFractionDigits: 2 })}`
            : '¥0';
    }

    function formatPaymentOrderAmount(order, fallbackValue) {
        const label = String(order?.display_amount_label || order?.amount_label || '').trim();
        if (label) return label;
        return formatCurrency(fallbackValue ?? order?.paid_amount ?? order?.expected_amount);
    }

    function getPaymentOrderSettlementLabel(order) {
        return String(order?.settlement_amount_label || '').trim();
    }

    function formatPoints(value) {
        const num = Number(value || 0);
        return Number.isFinite(num)
            ? num.toLocaleString('zh-CN', { minimumFractionDigits: num % 1 ? 1 : 0, maximumFractionDigits: 1 })
            : '0';
    }

    function formatPrecisePoints(value) {
        const num = Number(value || 0);
        return Number.isFinite(num)
            ? num.toLocaleString('zh-CN', { minimumFractionDigits: num % 1 ? 2 : 0, maximumFractionDigits: 2 })
            : '0';
    }

    function formatRatioPercent(value) {
        const num = Number(value);
        if (!Number.isFinite(num)) return '—';
        const percent = num * 100;
        return `${percent.toLocaleString('zh-CN', {
            minimumFractionDigits: Math.abs(percent % 1) > 0.001 ? 2 : 0,
            maximumFractionDigits: 2
        })}%`;
    }

    function normalizePaymentsContextObject(value) {
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    }

    function normalizePaymentsTabId(tabId = '') {
        const normalizedTab = String(tabId || '').trim().toLowerCase();
        return PAYMENTS_TABS.has(normalizedTab) ? normalizedTab : 'overview';
    }

    function formatSignedPoints(value) {
        const num = Number(value || 0);
        if (!Number.isFinite(num)) return '0';
        const sign = num > 0 ? '+' : '';
        return `${sign}${num.toLocaleString('zh-CN', { minimumFractionDigits: num % 1 ? 1 : 0, maximumFractionDigits: 1 })}`;
    }

    function formatPercent(value) {
        const num = Number(value || 0);
        return Number.isFinite(num) ? `${num.toFixed(2).replace(/\.00$/, '')}%` : '0%';
    }

    function hasWorkbenchContext(context = {}) {
        if (!context || typeof context !== 'object' || Array.isArray(context)) {
            return false;
        }

        const normalizedContext = normalizePaymentsContextObject(context);
        const payload = normalizePaymentsContextObject(normalizedContext.payload);
        const raw = normalizePaymentsContextObject(normalizedContext.raw);
        const focus = normalizePaymentsContextObject(normalizedContext.focus);

        return Boolean(String(
            normalizedContext.referenceValue
            || normalizedContext.referenceLabel
            || normalizedContext.query
            || normalizedContext.queryLabel
            || normalizedContext.productId
            || normalizedContext.productName
            || normalizedContext.topicKey
            || normalizedContext.exceptionTopic
            || normalizedContext.paymentOrderId
            || normalizedContext.providerOrderNo
            || payload.referenceValue
            || payload.referenceLabel
            || payload.query
            || payload.queryLabel
            || payload.productId
            || payload.productName
            || payload.topicKey
            || payload.exceptionTopic
            || payload.paymentOrderId
            || payload.providerOrderNo
            || raw.referenceValue
            || raw.referenceLabel
            || raw.query
            || raw.queryLabel
            || raw.productId
            || raw.productName
            || raw.topicKey
            || raw.exceptionTopic
            || raw.paymentOrderId
            || raw.providerOrderNo
            || focus.paymentOrderId
            || focus.payment_order_id
            || ''
        ).trim());
    }

    function buildShopOrdersReturnContext(context = state.workbenchContext) {
        if (!hasWorkbenchContext(context)) {
            return null;
        }

        const normalizedContext = context && typeof context === 'object' && !Array.isArray(context)
            ? context
            : {};
        const query = String(
            normalizedContext.query
            || normalizedContext.email
            || normalizedContext.userId
            || ''
        ).trim();
        if (!query) {
            return null;
        }

        const explicitIssueKind = String(normalizedContext.issueKind || '').trim().toLowerCase();
        const explicitIssueValue = String(normalizedContext.issueValue || '').trim().toLowerCase();
        const currentFocus = String(state.issueSummaryFocus || resolveAnalyticsPriorityFocusKind(state.summary)).trim().toLowerCase();
        let issueKind = explicitIssueKind;
        let issueValue = explicitIssueValue;

        if (!issueKind) {
            if (currentFocus === 'refund') {
                issueKind = 'refund';
                issueValue = 'refunded';
            } else if (currentFocus === 'dead_letter') {
                issueKind = 'delivery';
                issueValue = 'dead_letter';
            } else if (currentFocus === 'retry') {
                issueKind = 'delivery';
                issueValue = 'retry_waiting';
            }
        }

        return {
            tab: 'orders',
            mode: 'orders',
            query,
            queryLabel: String(normalizedContext.queryLabel || '用户').trim() || '用户',
            referenceLabel: String(normalizedContext.referenceLabel || '用户').trim() || '用户',
            referenceValue: String(normalizedContext.referenceValue || query).trim() || query,
            site: String(normalizedContext.site || '').trim().toLowerCase(),
            productId: String(normalizedContext.productId || '').trim(),
            productName: String(normalizedContext.productName || '').trim(),
            userId: String(normalizedContext.userId || '').trim(),
            email: String(normalizedContext.email || '').trim(),
            signalLabel: String(normalizedContext.signalLabel || '').trim(),
            signalValue: String(normalizedContext.signalValue || '').trim(),
            rangeLabel: String(normalizedContext.rangeLabel || '').trim(),
            issueKind,
            issueValue,
            refundStatus: issueKind === 'refund' ? 'refunded' : 'all',
            deliveryStatus: issueKind === 'delivery' ? issueValue || 'all' : 'all'
        };
    }

    function buildShopOrdersReturnAttrs(context = state.workbenchContext, options = {}) {
        const payload = buildShopOrdersReturnContext(context);
        if (!payload) {
            return '';
        }

        const serializedContext = typeof serializeAnalyticsActionContext === 'function'
            ? serializeAnalyticsActionContext(payload)
            : '';
        if (!serializedContext) {
            return '';
        }

        return `data-admin-action="analytics-open-destination" data-analytics-destination="${escapeHtml(String(options.destination || 'shop-orders').trim() || 'shop-orders')}" data-analytics-context="${escapeHtml(serializedContext)}"`;
    }

    function hasUserCommerceWorkbenchContext(context = state.workbenchContext) {
        if (!hasWorkbenchContext(context)) {
            return false;
        }

        const normalizedContext = context && typeof context === 'object' && !Array.isArray(context)
            ? context
            : {};
        const labels = [
            String(normalizedContext.referenceLabel || '').trim(),
            String(normalizedContext.queryLabel || '').trim()
        ].filter(Boolean);
        return Boolean(String(normalizedContext.userId || '').trim())
            && (labels.includes('用户') || labels.includes('User') || Boolean(String(normalizedContext.email || '').trim()));
    }

    function buildUserCommerceReturnContext(context = state.workbenchContext) {
        if (!hasUserCommerceWorkbenchContext(context)) {
            return null;
        }

        const normalizedContext = context && typeof context === 'object' && !Array.isArray(context)
            ? context
            : {};
        const userLabel = String(
            normalizedContext.referenceValue
            || normalizedContext.queryLabel
            || normalizedContext.query
            || normalizedContext.email
            || normalizedContext.userId
            || '当前用户'
        ).trim() || '当前用户';
        const currentFocus = String(state.issueSummaryFocus || resolveAnalyticsPriorityFocusKind(state.summary)).trim().toLowerCase();
        const focusLabelMap = {
            review: '待审核支付',
            failed: '失败订单',
            refund: '退款异常',
            dead_letter: '死信问题',
            retry: '待重试问题',
            ops: '站外告警'
        };
        const focusLabel = focusLabelMap[currentFocus] || '支付问题';

        return {
            sourceLabel: String(normalizedContext.sourceLabel || '').trim() || '商品经营影响用户',
            summary: `当前已围绕“${focusLabel}”处理 ${userLabel} 的支付承接链，适合回到用户侧继续确认订单、支付和售后是否同步回落。`,
            signalLabel: String(normalizedContext.signalLabel || '').trim(),
            signalValue: String(normalizedContext.signalValue || '').trim(),
            productId: String(normalizedContext.productId || '').trim(),
            productName: String(normalizedContext.productName || '').trim(),
            site: String(normalizedContext.site || '').trim().toLowerCase(),
            siteLabel: String(normalizedContext.siteLabel || '').trim(),
            rangeLabel: String(normalizedContext.rangeLabel || '').trim(),
            referenceLabel: '用户',
            referenceValue: userLabel,
            actionLabel: String(normalizedContext.actionLabel || '').trim() || '回到商品经营',
            verificationMethod: String(normalizedContext.verificationMethod || '').trim() || '回到用户侧确认支付问题、订单承接链和商品预警是否一起回落。',
            destination: String(normalizedContext.destination || '').trim().toLowerCase(),
            destinationContext: normalizedContext.destinationContext && typeof normalizedContext.destinationContext === 'object' && !Array.isArray(normalizedContext.destinationContext)
                ? { ...normalizedContext.destinationContext }
                : {}
        };
    }

    function buildUserCommerceReturnAttrs(context = state.workbenchContext) {
        const normalizedContext = context && typeof context === 'object' && !Array.isArray(context)
            ? context
            : {};
        const analyticsContext = buildUserCommerceReturnContext(normalizedContext);
        if (!String(normalizedContext.userId || '').trim() || !analyticsContext) {
            return '';
        }

        const serializedContext = typeof serializeAnalyticsActionContext === 'function'
            ? serializeAnalyticsActionContext(analyticsContext)
            : '';
        return `data-admin-action="analytics-open-user-detail" data-user-id="${escapeHtml(String(normalizedContext.userId || '').trim())}"${serializedContext ? ` data-analytics-context="${escapeHtml(serializedContext)}"` : ''}`;
    }

    function hasContentCommerceReturnContext(context = state.workbenchContext) {
        if (!hasWorkbenchContext(context)) {
            return false;
        }

        const normalizedContext = context && typeof context === 'object' && !Array.isArray(context)
            ? context
            : {};

        const destination = String(normalizedContext.destination || '').trim().toLowerCase();
        const referenceLabel = String(normalizedContext.referenceLabel || '').trim();
        return destination === 'analytics-content'
            && referenceLabel === 'Prompt'
            && Boolean(String(normalizedContext.referenceValue || normalizedContext.promptTitle || '').trim());
    }

    function buildContentCommerceReturnContext(context = state.workbenchContext) {
        if (!hasContentCommerceReturnContext(context)) {
            return null;
        }

        const normalizedContext = context && typeof context === 'object' && !Array.isArray(context)
            ? context
            : {};
        const promptLabel = String(
            normalizedContext.referenceValue
            || normalizedContext.promptTitle
            || normalizedContext.referenceLabel
            || '当前内容'
        ).trim() || '当前内容';
        const currentFocus = String(state.issueSummaryFocus || resolveAnalyticsPriorityFocusKind(state.summary)).trim().toLowerCase();
        const focusLabelMap = {
            review: '待审核支付',
            failed: '失败订单',
            refund: '退款异常',
            dead_letter: '死信问题',
            retry: '待重试问题',
            ops: '站外告警'
        };
        const focusLabel = focusLabelMap[currentFocus] || '支付问题';

        return {
            sourceLabel: String(normalizedContext.sourceLabel || '').trim() || '内容带货详情',
            summary: `当前已围绕“${focusLabel}”处理 ${promptLabel} 的带货支付链，适合回到内容带货详情确认归因支付、退款和履约信号是否同步回落。`,
            signalLabel: String(normalizedContext.signalLabel || '').trim(),
            signalValue: String(normalizedContext.signalValue || '').trim(),
            productId: String(normalizedContext.productId || '').trim(),
            productName: String(normalizedContext.productName || '').trim(),
            site: String(normalizedContext.site || '').trim().toLowerCase(),
            siteLabel: String(normalizedContext.siteLabel || '').trim(),
            rangeLabel: String(normalizedContext.rangeLabel || '').trim(),
            referenceLabel: 'Prompt',
            referenceValue: promptLabel,
            referenceId: String(normalizedContext.promptId || normalizedContext.referenceId || '').trim(),
            promptId: String(normalizedContext.promptId || normalizedContext.referenceId || '').trim(),
            promptTitle: promptLabel,
            actionLabel: String(normalizedContext.actionLabel || '').trim() || '回内容带货详情',
            verificationMethod: String(normalizedContext.verificationMethod || '').trim() || '回到内容带货详情，确认归因支付、带货订单样本和异常摘要是否一起回落。',
            destination: 'analytics-content',
            destinationContext: {
                sectionId: 'contentCommerceDetailSection',
                focusTargetId: 'contentCommerceDetailSection'
            }
        };
    }

    function buildContentCommerceReturnAttrs(context = state.workbenchContext) {
        const normalizedContext = context && typeof context === 'object' && !Array.isArray(context)
            ? context
            : {};
        const analyticsContext = buildContentCommerceReturnContext(normalizedContext);
        if (!analyticsContext) {
            return '';
        }

        const serializedContext = typeof serializeAnalyticsActionContext === 'function'
            ? serializeAnalyticsActionContext(analyticsContext)
            : '';
        if (!serializedContext) {
            return '';
        }

        return `data-admin-action="analytics-open-destination" data-analytics-destination="analytics-content" data-analytics-context="${escapeHtml(serializedContext)}"`;
    }

    function buildPaymentsWorkbenchContextFallbackState(context = {}) {
        if (!hasWorkbenchContext(context)) {
            return null;
        }

        const normalizedContext = normalizePaymentsContextObject(context);
        const contextPayload = normalizePaymentsContextObject(normalizedContext.payload);
        const contextRaw = normalizePaymentsContextObject(normalizedContext.raw);
        const referenceValue = String(
            normalizedContext.referenceValue
            || contextPayload.referenceValue
            || contextRaw.referenceValue
            || normalizedContext.queryLabel
            || contextPayload.queryLabel
            || contextRaw.queryLabel
            || normalizedContext.query
            || contextPayload.query
            || contextRaw.query
            || normalizedContext.productName
            || contextPayload.productName
            || contextRaw.productName
            || normalizedContext.providerOrderNo
            || contextPayload.providerOrderNo
            || contextRaw.providerOrderNo
            || ''
        ).trim();
        const sourceLabel = String(
            normalizedContext.sourceLabel
            || contextPayload.sourceLabel
            || contextRaw.sourceLabel
            || '分析联动'
        ).trim() || '分析联动';

        return {
            eyebrow: 'Payments Focus',
            title: '当前来自支付联动上下文',
            summary: referenceValue
                ? `当前支付页已围绕“${referenceValue}”展示问题摘要、优先处理项和站外告警。`
                : '当前支付页已接收外部联动上下文，可继续查看问题摘要、优先处理项和站外告警。',
            chips: [
                { label: '来源', value: sourceLabel },
                referenceValue ? { label: '目标', value: referenceValue } : null
            ].filter(Boolean)
        };
    }

    function buildAnalyticsIssueSummaryState(data = {}, context = state.workbenchContext) {
        if (!hasWorkbenchContext(context)) {
            return null;
        }

        const normalizedContext = normalizePaymentsContextObject(context);
        const contextFocus = normalizePaymentsContextObject(normalizedContext.focus);
        const contextPayload = normalizePaymentsContextObject(normalizedContext.payload);
        const contextRaw = normalizePaymentsContextObject(normalizedContext.raw);
        const anomaly = data?.anomaly_summary || {};
        const ops = data?.ops_alert_summary || {};
        const referenceValue = String(
            normalizedContext.referenceValue
            || contextPayload.referenceValue
            || contextRaw.referenceValue
            || normalizedContext.queryLabel
            || contextPayload.queryLabel
            || contextRaw.queryLabel
            || normalizedContext.query
            || contextPayload.query
            || contextRaw.query
            || normalizedContext.productName
            || contextPayload.productName
            || contextRaw.productName
            || normalizedContext.productId
            || contextPayload.productId
            || contextRaw.productId
            || normalizedContext.referenceLabel
            || contextPayload.referenceLabel
            || contextRaw.referenceLabel
            || ''
        ).trim();
        const focusedPaymentOrderId = String(
            contextFocus.paymentOrderId
            || contextFocus.payment_order_id
            || contextPayload.paymentOrderId
            || contextPayload.payment_order_id
            || contextRaw.paymentOrderId
            || contextRaw.payment_order_id
            || normalizedContext.paymentOrderId
            || normalizedContext.payment_order_id
            || normalizedContext.providerOrderNo
            || normalizedContext.provider_order_no
            || state.focusOrderId
            || ''
        ).trim();
        const focusedOrder = focusedPaymentOrderId
            ? (Array.isArray(data?.recent_orders) ? data.recent_orders : []).find((order) => (
                [order?.id, order?.provider_order_no]
                    .map((value) => String(value || '').trim())
                    .filter(Boolean)
                    .includes(focusedPaymentOrderId)
            )) || null
            : null;
        const reviewCount = Math.max(0, Number(anomaly.review_orders || 0) || 0);
        const failedCount = Math.max(0, Number(anomaly.failed_orders || 0) || 0);
        const refundIssueCount = getRefundIssueCount(data);
        const pendingOpsCount = Math.max(0, Number(ops.pending || 0) || 0);
        const retryOpsCount = Math.max(0, Number(ops.retry || 0) || 0);
        const processingOpsCount = Math.max(0, Number(ops.processing || 0) || 0);
        const deadLetterCount = Math.max(0, Number(ops.dead_letter || 0) || 0);
        const openOpsCount = pendingOpsCount + retryOpsCount + processingOpsCount + deadLetterCount;
        const chips = [
            { label: '待审核', value: formatNumber(reviewCount), action: reviewCount > 0 ? 'review' : '' },
            { label: '失败订单', value: formatNumber(failedCount), action: failedCount > 0 ? 'failed' : '' },
            { label: '退款异常', value: formatNumber(refundIssueCount), action: refundIssueCount > 0 ? 'refund' : '' },
            { label: '站外告警', value: formatNumber(openOpsCount), action: openOpsCount > 0 ? 'ops' : '' }
        ];

        if (deadLetterCount > 0) {
            chips.push({ label: '死信', value: formatNumber(deadLetterCount), action: 'dead_letter' });
        } else if (retryOpsCount > 0) {
            chips.push({ label: '待重试', value: formatNumber(retryOpsCount), action: 'retry' });
        }

        return {
            eyebrow: 'Issue Summary',
            title: '当前支付问题摘要',
            summary: referenceValue
                ? `当前支付页仍按全站汇总展示，但已围绕“${referenceValue}”聚焦支付异常、退款售后与站外告警。`
                : '当前支付页会沿用分析来源，把待审核、失败订单、退款售后与站外告警压成一屏问题摘要。',
            chips: chips.filter((item) => String(item?.value || '').trim()),
            focusItem: focusedOrder
                ? {
                    title: String(focusedOrder.provider_order_no || focusedOrder.id || focusedPaymentOrderId).trim() || focusedPaymentOrderId,
                    meta: [
                        String(focusedOrder.package_name || '未匹配套餐').trim() || '未匹配套餐',
                        formatPaymentOrderAmount(focusedOrder),
                        getStatusLabel(focusedOrder.status),
                        String(focusedOrder.site || 'cn').trim().toUpperCase()
                    ],
                    recommendation: '这笔支付单已经定位到最近订单列表，继续审核、放行或回到订单承接链会更顺手。',
                    actionLabel: '重新定位',
                    targetId: String(focusedOrder.id || focusedPaymentOrderId).trim() || focusedPaymentOrderId
                }
                : null
        };
    }

    function resolveAnalyticsPriorityFocusKind(data = state.summary) {
        const explicit = String(state.issueSummaryFocus || '').trim().toLowerCase();
        if (explicit) {
            return explicit;
        }

        if (state.activeTab === 'ops') {
            if (String(state.exceptionTopicFilter || 'all').trim().toLowerCase() !== 'all') {
                return 'refund';
            }
            return 'ops';
        }

        const anomaly = data?.anomaly_summary || {};
        const ops = data?.ops_alert_summary || {};
        const candidates = [
            { key: 'review', count: Math.max(0, Number(anomaly.review_orders || 0) || 0) },
            { key: 'failed', count: Math.max(0, Number(anomaly.failed_orders || 0) || 0) },
            {
                key: 'refund',
                count: getRefundIssueCount(data)
            },
            {
                key: 'ops',
                count: Math.max(0, Number(ops.pending || 0) || 0)
                    + Math.max(0, Number(ops.retry || 0) || 0)
                    + Math.max(0, Number(ops.processing || 0) || 0)
                    + Math.max(0, Number(ops.dead_letter || 0) || 0)
            }
        ].sort((left, right) => right.count - left.count);

        return candidates[0]?.count > 0 ? candidates[0].key : '';
    }

    function buildAnalyticsPrioritySummaryState(data = state.summary, focus = resolveAnalyticsPriorityFocusKind(data), context = state.workbenchContext) {
        if (!hasWorkbenchContext(context)) {
            return null;
        }

        const normalizedFocus = String(focus || '').trim().toLowerCase();
        const recentOrders = Array.isArray(data?.recent_orders) ? data.recent_orders : [];
        const refundItems = getActiveRefundAlertItems(data);
        const opsItems = Array.isArray(data?.ops_alert_items) ? data.ops_alert_items : [];

        let title = '建议先处理的支付异常';
        let summary = '当前来源下已将最值得先跟进的支付异常顶出来，方便直接进入处理。';
        let items = [];

        const resolveRecommendedOrderAction = (order, preferredActions = []) => {
            const actions = Array.isArray(order?.order_available_actions) ? order.order_available_actions : [];
            for (const action of preferredActions) {
                if (actions.includes(action)) {
                    return action;
                }
            }
            return actions[0] || '';
        };
        const resolveRecommendedAnomalyAction = (item, preferredActions = []) => {
            const actions = Array.isArray(item?.ops_available_actions) ? item.ops_available_actions : [];
            for (const action of preferredActions) {
                if (actions.includes(action)) {
                    return action;
                }
            }
            return actions[0] || '';
        };

        if (normalizedFocus === 'review') {
            title = '建议先处理的待审核订单';
            summary = '这些订单仍停留在人工审核视角，适合优先处理以缩短支付确认时延。';
            items = recentOrders
                .filter((order) => {
                    const actions = Array.isArray(order?.order_available_actions) ? order.order_available_actions : [];
                    return actions.includes('approve_review') || actions.includes('reject_review');
                })
                .slice(0, 3)
                .map((order, index) => {
                    const recommendedAction = resolveRecommendedOrderAction(order, ['approve_review', 'reject_review']);
                    return ({
                    rankLabel: `TOP ${index + 1}`,
                    title: order?.provider_order_no || order?.package_name || '待审核订单',
                    meta: [
                        order?.package_name || '未匹配套餐',
                        formatPaymentOrderAmount(order),
                        getStatusLabel(order?.status)
                    ],
                    recommendation: '建议动作：先核对套餐映射和支付金额，再决定审核通过或驳回。',
                    actionType: 'order',
                    targetId: String(order?.id || '').trim(),
                    actionLabel: '看订单',
                    recommendedAction,
                    recommendedActionLabel: recommendedAction ? getAnomalyActionLabel(recommendedAction) : ''
                });
                });
        } else if (normalizedFocus === 'failed') {
            title = '建议先处理的失败订单';
            summary = '这些订单更接近支付异常或金额不一致，适合先核对并决定是否放行。';
            items = recentOrders
                .filter((order) => {
                    const actions = Array.isArray(order?.order_available_actions) ? order.order_available_actions : [];
                    const normalizedStatus = String(order?.status || '').trim().toLowerCase();
                    return actions.includes('approve_amount_mismatch')
                        || actions.includes('reject_amount_mismatch')
                        || normalizedStatus === 'amount_mismatch'
                        || normalizedStatus === 'rejected';
                })
                .slice(0, 3)
                .map((order, index) => {
                    const recommendedAction = resolveRecommendedOrderAction(order, ['approve_amount_mismatch', 'reject_amount_mismatch']);
                    return ({
                    rankLabel: `TOP ${index + 1}`,
                    title: order?.provider_order_no || order?.package_name || '失败订单',
                    meta: [
                        order?.package_name || '未匹配套餐',
                        formatPaymentOrderAmount(order),
                        getStatusLabel(order?.status)
                    ],
                    recommendation: '建议动作：先比对支付金额、套餐价格和订单来源，再决定人工放行或拒绝入账。',
                    actionType: 'order',
                    targetId: String(order?.id || '').trim(),
                    actionLabel: '看订单',
                    recommendedAction,
                    recommendedActionLabel: recommendedAction ? getAnomalyActionLabel(recommendedAction) : ''
                });
                });
        } else if (normalizedFocus === 'refund') {
            title = '建议先处理的退款异常';
            summary = '这些退款专题项仍未闭环，适合先切进对应专题继续跟进。';
            items = refundItems
                .filter((item) => !RESOLVED_ANOMALY_STATUSES.has(normalizeStatusValue(item?.ops_status)))
                .sort((left, right) => {
                    const leftPriority = REFUND_TOPIC_ORDER.indexOf(String(left?.topic_key || '').trim().toLowerCase());
                    const rightPriority = REFUND_TOPIC_ORDER.indexOf(String(right?.topic_key || '').trim().toLowerCase());
                    return (leftPriority === -1 ? 99 : leftPriority) - (rightPriority === -1 ? 99 : rightPriority);
                })
                .slice(0, 3)
                .map((item, index) => {
                    const recommendedAction = resolveRecommendedAnomalyAction(item, ['refund_zpay', 'refund_hupijiao', 'refund_nowpayments', 'request_retry', 'mark_handled', 'ignore']);
                    return ({
                    rankLabel: `TOP ${index + 1}`,
                    title: item?.title || item?.topic_label || '退款异常',
                    meta: [
                        item?.topic_label || '退款专题',
                        `${getAnomalyReferenceLabel(item)}：${getAnomalyReferenceValue(item)}`,
                        formatDateTime(item?.created_at)
                    ],
                    recommendation: getHandlingSuggestion(item),
                    actionType: 'topic',
                    targetId: String(item?.topic_key || 'refund_failures').trim().toLowerCase(),
                    actionLabel: '去专题',
                    recommendedAction,
                    recommendedActionLabel: recommendedAction ? getAnomalyActionLabel(recommendedAction) : '',
                    handleTargetType: String(item?.type || '').trim(),
                    handleTargetId: String(item?.id || '').trim()
                });
                });
        } else if (normalizedFocus === 'dead_letter' || normalizedFocus === 'retry' || normalizedFocus === 'ops') {
            title = normalizedFocus === 'dead_letter'
                ? '建议先处理的死信告警'
                : normalizedFocus === 'retry'
                    ? '建议先处理的待重试告警'
                    : '建议先处理的站外告警';
            summary = normalizedFocus === 'dead_letter'
                ? '这些告警已经进入死信状态，建议优先回到站外告警队列排查根因。'
                : normalizedFocus === 'retry'
                    ? '这些告警仍在等待重试，建议尽快确认通道与消息状态。'
                    : '这些站外告警仍未闭环，适合先进入告警队列处理。';
            items = opsItems
                .filter((item) => {
                    const status = String(item?.queue_status || '').trim().toLowerCase();
                    if (normalizedFocus === 'dead_letter') return status === 'dead_letter';
                    if (normalizedFocus === 'retry') return status === 'retry';
                    return ACTIVE_OPS_ALERT_STATUSES.has(status);
                })
                .slice(0, 3)
                .map((item, index) => {
                    const recommendedAction = resolveRecommendedAnomalyAction(
                        item,
                        normalizedFocus === 'dead_letter'
                            ? ['request_retry', 'mark_handled', 'ignore']
                            : normalizedFocus === 'retry'
                                ? ['mark_handled', 'request_retry', 'ignore']
                                : ['mark_handled', 'request_retry', 'ignore']
                    );
                    return ({
                    rankLabel: `TOP ${index + 1}`,
                    title: item?.title || '站外告警',
                    meta: [
                        getAnomalyOpsStatusLabel(item?.queue_status),
                        `${getAnomalyReferenceLabel(item)}：${getAnomalyReferenceValue(item)}`,
                        formatDateTime(item?.created_at)
                    ],
                    recommendation: getHandlingSuggestion(item),
                    actionType: 'ops',
                    targetId: '',
                    actionLabel: '去告警队列',
                    recommendedAction,
                    recommendedActionLabel: recommendedAction ? getAnomalyActionLabel(recommendedAction) : '',
                    handleTargetType: String(item?.type || '').trim(),
                    handleTargetId: String(item?.id || '').trim()
                });
                });
        }

        if (!items.length) {
            return null;
        }

        return {
            eyebrow: 'Priority',
            title,
            summary,
            items
        };
    }

    function renderAnalyticsPrioritySummary(data = state.summary, context = state.workbenchContext) {
        const target = document.getElementById('paymentsPrioritySummary');
        if (!target) return false;

        const summaryState = buildAnalyticsPrioritySummaryState(data || {}, resolveAnalyticsPriorityFocusKind(data), context || {});
        if (!summaryState) {
            target.hidden = true;
            target.innerHTML = '';
            return false;
        }

        target.innerHTML = `
            <div class="admin-workbench-context-note__eyebrow">${escapeHtml(summaryState.eyebrow || 'Priority')}</div>
            <div class="admin-workbench-context-note__title">${escapeHtml(summaryState.title || '建议先处理的支付异常')}</div>
            <div class="admin-workbench-context-note__summary">${escapeHtml(summaryState.summary || '')}</div>
            ${(buildShopOrdersReturnAttrs(context, { destination: 'shop-orders' }) || buildUserCommerceReturnAttrs(context) || buildContentCommerceReturnAttrs(context)) ? `
                <div class="admin-workbench-context-note__chips">
                    ${buildShopOrdersReturnAttrs(context, { destination: 'shop-orders' }) ? `
                        <button
                            type="button"
                            class="admin-workbench-context-note__chip admin-workbench-context-note__chip--action"
                            ${buildShopOrdersReturnAttrs(context, { destination: 'shop-orders' })}
                        >回订单承接链</button>
                    ` : ''}
                    ${buildUserCommerceReturnAttrs(context) ? `
                        <button
                            type="button"
                            class="admin-workbench-context-note__chip admin-workbench-context-note__chip--action"
                            ${buildUserCommerceReturnAttrs(context)}
                        >回用户承接链</button>
                    ` : ''}
                    ${buildContentCommerceReturnAttrs(context) ? `
                        <button
                            type="button"
                            class="admin-workbench-context-note__chip admin-workbench-context-note__chip--action"
                            ${buildContentCommerceReturnAttrs(context)}
                        >回内容带货详情</button>
                    ` : ''}
                </div>
            ` : ''}
            <div class="admin-workbench-priority-list">
                ${(Array.isArray(summaryState.items) ? summaryState.items : []).map((item) => `
                    <div class="admin-workbench-priority-item">
                        <div class="admin-workbench-priority-item__top">
                            <div class="admin-workbench-priority-item__title">${escapeHtml(item.title || '优先项')}</div>
                            ${item.rankLabel ? `<span class="admin-workbench-priority-item__rank">${escapeHtml(item.rankLabel)}</span>` : ''}
                        </div>
                        <div class="admin-workbench-priority-item__meta">
                            ${(Array.isArray(item.meta) ? item.meta : []).filter(Boolean).map((entry) => `
                                <span>${escapeHtml(entry)}</span>
                            `).join('')}
                        </div>
                        ${item.recommendation ? `<div class="admin-workbench-priority-item__recommendation">${escapeHtml(item.recommendation)}</div>` : ''}
                        <div class="admin-workbench-priority-item__actions">
                            ${item.recommendedAction && item.handleTargetType && item.handleTargetId ? `
                                <button
                                    type="button"
                                    class="admin-workbench-priority-item__btn"
                                    data-admin-action="payments-handle-anomaly-action"
                                    data-payments-target-type="${escapeHtml(item.handleTargetType || '')}"
                                    data-payments-target-id="${escapeHtml(item.handleTargetId || '')}"
                                    data-payments-action="${escapeHtml(item.recommendedAction || '')}"
                                >${escapeHtml(item.recommendedActionLabel || '执行建议')}</button>
                            ` : ''}
                            ${item.recommendedAction && item.actionType === 'order' ? `
                                <button
                                    type="button"
                                    class="admin-workbench-priority-item__btn"
                                    data-admin-action="payments-handle-anomaly-action"
                                    data-payments-target-type="order"
                                    data-payments-target-id="${escapeHtml(item.targetId || '')}"
                                    data-payments-action="${escapeHtml(item.recommendedAction || '')}"
                                >${escapeHtml(item.recommendedActionLabel || '执行建议')}</button>
                            ` : ''}
                            ${item.actionType === 'order' ? `
                                <button
                                    type="button"
                                    class="admin-workbench-priority-item__btn"
                                    data-admin-action="payments-priority-focus-order"
                                    data-payments-order-id="${escapeHtml(item.targetId || '')}"
                                >${escapeHtml(item.actionLabel || '看订单')}</button>
                            ` : ''}
                            ${item.actionType === 'topic' ? `
                                <button
                                    type="button"
                                    class="admin-workbench-priority-item__btn"
                                    data-admin-action="payments-priority-focus-topic"
                                    data-payments-topic-key="${escapeHtml(item.targetId || '')}"
                                >${escapeHtml(item.actionLabel || '去专题')}</button>
                            ` : ''}
                            ${item.actionType === 'ops' ? `
                                <button
                                    type="button"
                                    class="admin-workbench-priority-item__btn"
                                    data-admin-action="payments-priority-focus-ops"
                                >${escapeHtml(item.actionLabel || '去告警队列')}</button>
                            ` : ''}
                            ${buildShopOrdersReturnAttrs({
                                ...(context && typeof context === 'object' && !Array.isArray(context) ? context : {}),
                                issueKind: item.actionType === 'topic'
                                    ? 'refund'
                                    : (resolveAnalyticsPriorityFocusKind(data) === 'dead_letter' || resolveAnalyticsPriorityFocusKind(data) === 'retry' ? 'delivery' : ''),
                                issueValue: resolveAnalyticsPriorityFocusKind(data) === 'dead_letter'
                                    ? 'dead_letter'
                                    : (resolveAnalyticsPriorityFocusKind(data) === 'retry' ? 'retry_waiting' : '')
                            }, { destination: 'shop-orders' }) ? `
                                <button
                                    type="button"
                                    class="admin-workbench-priority-item__btn"
                                    ${buildShopOrdersReturnAttrs({
                                        ...(context && typeof context === 'object' && !Array.isArray(context) ? context : {}),
                                        issueKind: item.actionType === 'topic'
                                            ? 'refund'
                                            : (resolveAnalyticsPriorityFocusKind(data) === 'dead_letter' || resolveAnalyticsPriorityFocusKind(data) === 'retry' ? 'delivery' : ''),
                                        issueValue: resolveAnalyticsPriorityFocusKind(data) === 'dead_letter'
                                            ? 'dead_letter'
                                            : (resolveAnalyticsPriorityFocusKind(data) === 'retry' ? 'retry_waiting' : '')
                                    }, { destination: 'shop-orders' })}
                                >回订单承接链</button>
                            ` : ''}
                            ${buildContentCommerceReturnAttrs(context) ? `
                                <button
                                    type="button"
                                    class="admin-workbench-priority-item__btn"
                                    ${buildContentCommerceReturnAttrs(context)}
                                >回内容带货详情</button>
                            ` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
        target.hidden = false;
        return true;
    }

    function renderAnalyticsIssueSummary(data = state.summary, context = state.workbenchContext) {
        const target = document.getElementById('paymentsIssueSummary');
        if (!target) return false;

        const summaryState = buildAnalyticsIssueSummaryState(data || {}, context || {});
        if (!summaryState) {
            target.hidden = true;
            target.innerHTML = '';
            renderAnalyticsPrioritySummary(null, null);
            return false;
        }

        target.innerHTML = `
            <div class="admin-workbench-context-note__eyebrow">${escapeHtml(summaryState.eyebrow || 'Issue Summary')}</div>
            <div class="admin-workbench-context-note__title">${escapeHtml(summaryState.title || '当前支付问题摘要')}</div>
            <div class="admin-workbench-context-note__summary">${escapeHtml(summaryState.summary || '')}</div>
            <div class="admin-workbench-context-note__chips">
                ${(Array.isArray(summaryState.chips) ? summaryState.chips : []).map((item) => `
                    ${item?.action
                        ? `
                            <button
                                type="button"
                                class="admin-workbench-context-note__chip admin-workbench-context-note__chip--action"
                                data-admin-action="payments-issue-summary-focus"
                                data-payments-issue-focus="${escapeHtml(item.action)}"
                            >${escapeHtml(item.label || '')} · ${escapeHtml(item.value || '')}</button>
                        `
                        : `<span class="admin-workbench-context-note__chip">${escapeHtml(item.label || '')} · ${escapeHtml(item.value || '')}</span>`
                    }
                `).join('')}
                ${buildShopOrdersReturnAttrs(context, { destination: 'shop-orders' })
                    ? `
                        <button
                            type="button"
                            class="admin-workbench-context-note__chip admin-workbench-context-note__chip--action"
                            ${buildShopOrdersReturnAttrs(context, { destination: 'shop-orders' })}
                        >回订单承接链</button>
                    `
                    : ''
                }
                ${buildUserCommerceReturnAttrs(context)
                    ? `
                        <button
                            type="button"
                            class="admin-workbench-context-note__chip admin-workbench-context-note__chip--action"
                            ${buildUserCommerceReturnAttrs(context)}
                        >回用户承接链</button>
                    `
                    : ''
                }
                ${buildContentCommerceReturnAttrs(context)
                    ? `
                        <button
                            type="button"
                            class="admin-workbench-context-note__chip admin-workbench-context-note__chip--action"
                            ${buildContentCommerceReturnAttrs(context)}
                        >回内容带货详情</button>
                    `
                    : ''
                }
            </div>
            ${summaryState.focusItem ? `
                <div class="admin-workbench-priority-list">
                    <div class="admin-workbench-priority-item">
                        <div class="admin-workbench-priority-item__top">
                            <div class="admin-workbench-priority-item__title">${escapeHtml(summaryState.focusItem.title || '当前支付单')}</div>
                            <span class="admin-workbench-priority-item__rank">已聚焦</span>
                        </div>
                        <div class="admin-workbench-priority-item__meta">
                            ${(Array.isArray(summaryState.focusItem.meta) ? summaryState.focusItem.meta : []).filter(Boolean).map((entry) => `
                                <span>${escapeHtml(entry)}</span>
                            `).join('')}
                        </div>
                        ${summaryState.focusItem.recommendation ? `<div class="admin-workbench-priority-item__recommendation">${escapeHtml(summaryState.focusItem.recommendation)}</div>` : ''}
                        ${summaryState.focusItem.targetId ? `
                            <div class="admin-workbench-priority-item__actions">
                                <button
                                    type="button"
                                    class="admin-workbench-priority-item__btn"
                                    data-admin-action="payments-priority-focus-order"
                                    data-payments-order-id="${escapeHtml(summaryState.focusItem.targetId || '')}"
                                >${escapeHtml(summaryState.focusItem.actionLabel || '重新定位')}</button>
                            </div>
                        ` : ''}
                    </div>
                </div>
            ` : ''}
        `;
        target.hidden = false;
        renderAnalyticsPrioritySummary(data, context);
        return true;
    }

    async function focusAnalyticsIssueSummary(kind = '') {
        const normalizedKind = String(kind || '').trim().toLowerCase();
        if (!normalizedKind) return;
        state.issueSummaryFocus = normalizedKind;

        if (normalizedKind === 'refund') {
            const refundTopics = (Array.isArray(state.summary?.refund_alert_topics) ? state.summary.refund_alert_topics : [])
                .filter((topic) => Number(topic?.count || 0) > 0)
                .sort((left, right) => REFUND_TOPIC_ORDER.indexOf(String(left?.key || '').trim().toLowerCase()) - REFUND_TOPIC_ORDER.indexOf(String(right?.key || '').trim().toLowerCase()));
            await focusExceptionTopic(String(refundTopics[0]?.key || 'refund_failures').trim().toLowerCase() || 'refund_failures');
            renderAnalyticsPrioritySummary(state.summary, state.workbenchContext);
            return;
        }

        if (normalizedKind === 'ops' || normalizedKind === 'dead_letter' || normalizedKind === 'retry') {
            await focusOpsAlertQueue();
            renderAnalyticsPrioritySummary(state.summary, state.workbenchContext);
            return;
        }

        if (normalizedKind === 'review' || normalizedKind === 'failed') {
            switchTab('ops', { reload: false });
            if (state.initialized) {
                if (!hasCachedDataForTab('ops')) {
                    await reload();
                } else {
                    renderOrders(state.summary || {});
                }
            }

            const target = document.getElementById('paymentsOrdersTable');
            if (target && typeof target.scrollIntoView === 'function') {
                window.setTimeout(() => {
                    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 40);
            }
        }
        renderAnalyticsPrioritySummary(state.summary, state.workbenchContext);
    }

    async function focusAnalyticsPrioritySummary(type = '', targetId = '') {
        const normalizedType = String(type || '').trim().toLowerCase();
        const normalizedTargetId = String(targetId || '').trim();

        if (normalizedType === 'order' && normalizedTargetId) {
            await focusOrder(normalizedTargetId);
            return;
        }

        if (normalizedType === 'topic' && normalizedTargetId) {
            state.issueSummaryFocus = 'refund';
            await focusExceptionTopic(normalizedTargetId);
            renderAnalyticsPrioritySummary(state.summary, state.workbenchContext);
            return;
        }

        if (normalizedType === 'ops') {
            state.issueSummaryFocus = 'ops';
            await focusOpsAlertQueue();
            renderAnalyticsPrioritySummary(state.summary, state.workbenchContext);
        }
    }

    function showWorkbenchContext(context = {}) {
        const target = document.getElementById('paymentsWorkbenchContext');
        if (!target) return false;
        state.issueSummaryFocus = '';
        state.workbenchContext = context && typeof context === 'object' && !Array.isArray(context)
            ? { ...context }
            : null;

        const contextState = window.buildOpsAlertWorkspaceAnalyticsSignalContextState?.(state.workbenchContext || {}, {
            title: '当前来自分析信号联动',
            eyebrow: 'Payments Focus'
        }) || buildPaymentsWorkbenchContextFallbackState(state.workbenchContext || {});

        if (!contextState) {
            target.hidden = true;
            target.innerHTML = '';
            renderAnalyticsIssueSummary(null, null);
            return false;
        }

        target.innerHTML = `
            <div class="admin-workbench-context-note__eyebrow">${escapeHtml(contextState.eyebrow || 'Analytics Context')}</div>
            <div class="admin-workbench-context-note__title">${escapeHtml(contextState.title || '分析信号聚焦上下文')}</div>
            <div class="admin-workbench-context-note__summary">${escapeHtml(contextState.summary || '')}</div>
            <div class="admin-workbench-context-note__chips">
                ${(Array.isArray(contextState.chips) ? contextState.chips : []).map((item) => `
                    <span class="admin-workbench-context-note__chip">${escapeHtml(item.label || '')} · ${escapeHtml(item.value || '')}</span>
                `).join('')}
            </div>
        `;
        target.hidden = false;
        renderAnalyticsIssueSummary(state.summary, state.workbenchContext);
        return true;
    }

    function getFriendlyErrorMessage(error, fallback = '支付数据刷新失败，请稍后重试。') {
        const message = String(error?.message || error || '').trim();
        const normalizedMessage = message.toLowerCase();
        const errorName = String(error?.name || '').trim();
        if (
            !message
            || errorName === 'AbortError'
            || normalizedMessage === 'typeerror: fetch failed'
            || normalizedMessage === 'fetch failed'
            || normalizedMessage === 'failed to fetch'
            || normalizedMessage === 'networkerror when attempting to fetch resource.'
            || normalizedMessage.includes('networkerror')
            || normalizedMessage.includes('load failed')
            || normalizedMessage.includes('network request failed')
        ) {
            return fallback;
        }
        return message;
    }

    function renderInfoChip(help) {
        if (!help) return '';
        return `
            <button type="button" class="payments-info-chip" aria-label="查看说明">
                <span class="payments-info-glyph" aria-hidden="true"></span>
                <span class="payments-info-tooltip" role="tooltip">${escapeHtml(help)}</span>
            </button>
        `;
    }

    function formatDateTime(value) {
        if (!value) return '—';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '—';
        return date.toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function formatDateForInput(date) {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
        const year = date.getFullYear();
        const month = `${date.getMonth() + 1}`.padStart(2, '0');
        const day = `${date.getDate()}`.padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function parseDateInput(value) {
        const text = String(value || '').trim();
        const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
        if (!matched) return null;
        const year = Number(matched[1]);
        const monthIndex = Number(matched[2]) - 1;
        const day = Number(matched[3]);
        const date = new Date(year, monthIndex, day);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function toRangeIso(value, endOfDay = false) {
        const date = parseDateInput(value);
        if (!date) return null;
        if (endOfDay) {
            date.setHours(23, 59, 59, 999);
        } else {
            date.setHours(0, 0, 0, 0);
        }
        return date.toISOString();
    }

    function getDefaultRangeValues(days = 30) {
        const end = new Date();
        end.setHours(0, 0, 0, 0);
        const start = new Date(end);
        start.setDate(start.getDate() - Math.max(0, days - 1));
        return {
            start: formatDateForInput(start),
            end: formatDateForInput(end)
        };
    }

    function ensureRangeDefaults() {
        if (state.customStartDate && state.customEndDate) return;
        const range = getDefaultRangeValues(state.days || 30);
        state.customStartDate = range.start;
        state.customEndDate = range.end;
    }

    function formatRangeLabelFromInputs(startValue, endValue) {
        const start = parseDateInput(startValue);
        const end = parseDateInput(endValue);
        if (!start || !end) return getRangeLabel(state.days);
        const startLabel = `${start.getMonth() + 1}/${start.getDate()}`;
        const endLabel = `${end.getMonth() + 1}/${end.getDate()}`;
        return `${startLabel} - ${endLabel}`;
    }

    function getCurrentRangeLabel() {
        if (state.rangeMode === 'custom' && state.customStartDate && state.customEndDate) {
            return formatRangeLabelFromInputs(state.customStartDate, state.customEndDate);
        }
        return getRangeLabel(state.days);
    }

    function isMobileViewport() {
        return window.innerWidth <= 768;
    }

    function isUltraNarrowViewport() {
        return window.innerWidth <= 430;
    }

    function formatToolbarTime(value) {
        if (!value) return '--';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '--';
        return date.toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }

    function getRangeDayDiff(startValue, endValue) {
        const start = parseDateInput(startValue);
        const end = parseDateInput(endValue);
        if (!start || !end) return 30;
        const diff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        return Math.max(1, diff);
    }

    function getStatusLabel(status) {
        const map = {
            paid: '已支付',
            redeemed: '已兑换',
            pending_review: '待审核',
            rejected: '已拒绝',
            amount_mismatch: '金额异常',
            pending: '待处理',
            refunded: '已退款',
            expired: '已过期'
        };
        return map[String(status || '')] || String(status || '未知');
    }

    function getProviderLabel(provider) {
        const map = {
            mock: '模拟支付',
            afdian: '爱发电',
            zpay: '易支付',
            hupijiao: '虎皮椒'
        };
        return map[String(provider || '').trim().toLowerCase()] || String(provider || '未知通道');
    }

    function getProviderIcon(provider) {
        const map = {
            mock: 'fas fa-bolt',
            afdian: 'fas fa-heart',
            zpay: 'fas fa-wallet',
            hupijiao: 'fas fa-pepper-hot'
        };
        return map[String(provider || '').trim().toLowerCase()] || 'fas fa-credit-card';
    }

    function getOpsAlertChannelLabel(channel) {
        const map = {
            telegram: 'Telegram',
            feishu: '飞书',
            shop_profit_audit: '净利润审计'
        };
        return map[String(channel || '').trim().toLowerCase()] || String(channel || '未知通道');
    }

    function getRefundTopicIcon(topicKey) {
        const map = {
            refund_compensation_failures: 'fas fa-triangle-exclamation',
            refund_reclaim_failures: 'fas fa-rotate-left',
            refund_failures: 'fas fa-arrow-rotate-left'
        };
        return map[String(topicKey || '').trim().toLowerCase()] || 'fas fa-bell';
    }

    function getRefundTopicTone(topic) {
        const severity = String(topic?.severity || '').trim().toLowerCase();
        if (severity === 'critical') return 'danger';
        if (severity === 'warning') return 'warning';
        return 'info';
    }

    function normalizeStatusValue(status) {
        return String(status || '').trim().toLowerCase();
    }

    function isResolvedAnomalyStatus(status) {
        return RESOLVED_ANOMALY_STATUSES.has(normalizeStatusValue(status));
    }

    function isActiveOpsAlertStatus(status) {
        return ACTIVE_OPS_ALERT_STATUSES.has(normalizeStatusValue(status));
    }

    function getRefundAlertItems(data = {}) {
        return Array.isArray(data?.refund_alert_items) ? data.refund_alert_items : [];
    }

    function hasRefundAlertItems(data = {}) {
        return Array.isArray(data?.refund_alert_items);
    }

    function getActiveRefundAlertItems(data = {}) {
        return getRefundAlertItems(data).filter((item) => !isResolvedAnomalyStatus(item?.ops_status));
    }

    function getRefundIssueBreakdown(data = {}) {
        if (hasRefundAlertItems(data)) {
            const activeItems = getActiveRefundAlertItems(data);
            return {
                refund_failures: activeItems.filter((item) => normalizeStatusValue(item?.topic_key) === 'refund_failures').length,
                refund_reclaim_failures: activeItems.filter((item) => normalizeStatusValue(item?.topic_key) === 'refund_reclaim_failures').length,
                refund_compensation_failures: activeItems.filter((item) => normalizeStatusValue(item?.topic_key) === 'refund_compensation_failures').length
            };
        }

        const anomaly = data?.anomaly_summary || {};
        return {
            refund_failures: Math.max(0, Number(anomaly.refund_failures || 0) || 0),
            refund_reclaim_failures: Math.max(0, Number(anomaly.refund_reclaim_failures || 0) || 0),
            refund_compensation_failures: Math.max(0, Number(anomaly.refund_compensation_failures || 0) || 0)
        };
    }

    function getRefundIssueCount(data = {}) {
        const breakdown = getRefundIssueBreakdown(data);
        return Number(breakdown.refund_failures || 0)
            + Number(breakdown.refund_reclaim_failures || 0)
            + Number(breakdown.refund_compensation_failures || 0);
    }

    function hasExceptionTopicSummary(data = {}) {
        return Array.isArray(data?.exception_topics);
    }

    function getExceptionTopicCount(data = {}, topicKey = '') {
        const normalizedTopicKey = String(topicKey || '').trim().toLowerCase();
        if (!normalizedTopicKey || !Array.isArray(data?.exception_topics)) return 0;
        const topic = data.exception_topics.find((item) => String(item?.key || '').trim().toLowerCase() === normalizedTopicKey);
        return Math.max(0, Number(topic?.count || 0) || 0);
    }

    function getCallbackIssueBreakdown(data = {}) {
        if (hasExceptionTopicSummary(data)) {
            return {
                duplicate_webhook_orders: getExceptionTopicCount(data, 'duplicate_webhook'),
                session_anomalies: Array.from(CALLBACK_EXCEPTION_TOPIC_KEYS)
                    .reduce((sum, topicKey) => sum + getExceptionTopicCount(data, topicKey), 0)
            };
        }

        const anomaly = data?.anomaly_summary || {};
        return {
            duplicate_webhook_orders: Math.max(0, Number(anomaly.duplicate_webhook_orders || 0) || 0),
            session_anomalies: Math.max(0, Number(anomaly.session_anomalies || 0) || 0)
        };
    }

    function getCallbackIssueCount(data = {}) {
        const breakdown = getCallbackIssueBreakdown(data);
        return Number(breakdown.duplicate_webhook_orders || 0)
            + Number(breakdown.session_anomalies || 0);
    }

    function getOverviewIssueBreakdown(data = {}) {
        const anomaly = data?.anomaly_summary || {};
        const reviewOrders = Math.max(0, Number(anomaly.review_orders || 0) || 0);
        const failedOrders = Math.max(0, Number(anomaly.failed_orders || 0) || 0);
        const callbackIssues = getCallbackIssueCount(data);
        const queryFailures = Math.max(0, Number(anomaly.query_failures || 0) || 0);
        const refundIssues = getRefundIssueCount(data);

        return {
            review_orders: reviewOrders,
            failed_orders: failedOrders,
            callback_issues: callbackIssues,
            query_failures: queryFailures,
            refund_issues: refundIssues,
            total: reviewOrders + failedOrders + callbackIssues + queryFailures + refundIssues
        };
    }

    function getOverviewIssueCount(data = {}) {
        return getOverviewIssueBreakdown(data).total;
    }

    function getPaymentsCommandCenterTimestamp(...values) {
        for (const value of values) {
            const timestamp = Date.parse(value || '');
            if (Number.isFinite(timestamp) && timestamp > 0) {
                return timestamp;
            }
        }
        return 0;
    }

    function getPaymentsCommandCenterToneFromSeverity(severity = '') {
        const normalized = String(severity || '').trim().toLowerCase();
        if (['critical', 'danger', 'error', 'high'].includes(normalized)) {
            return 'alert';
        }
        if (normalized) {
            return 'warn';
        }
        return '';
    }

    function getPaymentsCommandCenterToneFromQueueStatus(status = '') {
        const normalized = String(status || '').trim().toLowerCase();
        if (normalized === 'dead_letter') {
            return 'alert';
        }
        if (normalized) {
            return 'warn';
        }
        return '';
    }

    function getPaymentsCommandCenterRecentItems(data = state.summary) {
        const recentAnomalies = Array.isArray(data?.recent_anomalies) ? data.recent_anomalies : [];
        const recentOrders = Array.isArray(data?.recent_orders) ? data.recent_orders : [];
        const opsItems = Array.isArray(data?.ops_alert_items) ? data.ops_alert_items : [];

        const anomalyItems = recentAnomalies.map((item) => {
            const title = String(item?.title || item?.message || '').trim();
            const referenceValue = String(getAnomalyReferenceValue(item) || '').trim();
            const topicKey = String(item?.topic_key || '').trim().toLowerCase();
            const paymentOrderId = String(item?.payment_order_id || item?.order_id || '').trim();
            const copy = title
                ? (referenceValue && !title.includes(referenceValue) ? `${title} · ${referenceValue}` : title)
                : `${getAnomalyReferenceLabel(item)} ${referenceValue || '待复核'}`.trim();
            return {
                label: getAnomalyTypeLabel(item),
                copy,
                timestamp: getPaymentsCommandCenterTimestamp(item?.updated_at, item?.created_at),
                tone: getPaymentsCommandCenterToneFromSeverity(item?.severity),
                moduleId: 'payments',
                stateKey: `payments-anomaly-${String(item?.id || paymentOrderId || topicKey || referenceValue || title || 'recent').trim() || 'recent'}`,
                feedbackLabel: getAnomalyTypeLabel(item),
                intent: topicKey
                    ? `打开支付异常专题 ${topicKey}。`
                    : `打开支付异常列表并定位 ${referenceValue || '该异常'}。`,
                context: {
                    ...(!topicKey && paymentOrderId
                        ? {
                            focus: {
                                paymentOrderId
                            }
                        }
                        : {}),
                    payload: {
                        defaultTab: 'ops',
                        tab: 'ops',
                        ...(topicKey ? { exceptionTopic: topicKey } : {}),
                        ...(!topicKey ? { focusTargetId: 'paymentsAnomalyList' } : {})
                    }
                },
                options: {
                    defaultTab: 'ops',
                    tab: 'ops'
                }
            };
        });

        const orderItems = recentOrders
            .map((order) => {
                const actions = Array.isArray(order?.order_available_actions) ? order.order_available_actions : [];
                const isReview = actions.includes('approve_review') || actions.includes('reject_review');
                const isAmountMismatch = actions.includes('approve_amount_mismatch') || actions.includes('reject_amount_mismatch');
                if (!isReview && !isAmountMismatch) {
                    return null;
                }
                const paymentOrderId = String(order?.id || '').trim();
                const referenceValue = String(order?.provider_order_no || order?.id || '').trim() || '未匹配单号';
                const copy = [
                    String(order?.package_name || '支付订单').trim() || '支付订单',
                    referenceValue,
                    getStatusLabel(order?.status)
                ].filter(Boolean).join(' · ');
                return {
                    label: isReview ? '待审核订单' : '异常订单',
                    copy,
                    timestamp: getPaymentsCommandCenterTimestamp(order?.updated_at, order?.paid_at, order?.created_at),
                    tone: isAmountMismatch ? 'alert' : 'warn',
                    moduleId: 'payments',
                    stateKey: `payments-order-${paymentOrderId || referenceValue}`,
                    feedbackLabel: referenceValue,
                    intent: `打开支付订单 ${referenceValue}。`,
                    context: {
                        ...(paymentOrderId
                            ? {
                                focus: {
                                    paymentOrderId
                                }
                            }
                            : {}),
                        payload: {
                            defaultTab: 'ops',
                            tab: 'ops',
                            ...(!paymentOrderId ? { issueSummary: isReview ? 'review' : 'failed' } : {})
                        }
                    },
                    options: {
                        defaultTab: 'ops',
                        tab: 'ops'
                    }
                };
            })
            .filter(Boolean);

        const opsRecentItems = opsItems
            .filter((item) => ACTIVE_OPS_ALERT_STATUSES.has(normalizeStatusValue(item?.queue_status)))
            .map((item) => {
                const copy = String(item?.title || item?.message || '').trim()
                    || `${getAnomalyReferenceLabel(item)} ${getAnomalyReferenceValue(item)}`.trim();
                return {
                    label: '回调队列',
                    copy,
                    timestamp: getPaymentsCommandCenterTimestamp(item?.updated_at, item?.created_at),
                    tone: getPaymentsCommandCenterToneFromQueueStatus(item?.queue_status),
                    moduleId: 'payments',
                    stateKey: `payments-ops-${String(item?.id || item?.provider_order_no || item?.created_at || 'queue').trim() || 'queue'}`,
                    feedbackLabel: '回调队列',
                    intent: '打开支付运维页的回调队列。',
                    context: {
                        payload: {
                            defaultTab: 'ops',
                            tab: 'ops',
                            focusTargetId: 'paymentsOpsAlertQueue'
                        }
                    },
                    options: {
                        defaultTab: 'ops',
                        tab: 'ops'
                    }
                };
            });

        return [...anomalyItems, ...orderItems, ...opsRecentItems]
            .filter((item) => item && item.copy)
            .sort((left, right) => Number(right?.timestamp || 0) - Number(left?.timestamp || 0))
            .slice(0, 3);
    }

    function getPaymentsCommandCenterSummary() {
        const data = state.summary || {};
        const overview = data?.overview || {};
        const anomaly = data?.anomaly_summary || {};
        const ops = data?.ops_alert_summary || {};
        const retryCount = Math.max(0, Number(ops.retry || 0) || 0);
        const pendingCount = Math.max(0, Number(ops.pending || 0) || 0);
        const processingCount = Math.max(0, Number(ops.processing || 0) || 0);
        const deadLetterCount = Math.max(0, Number(ops.dead_letter || 0) || 0);
        const actionableOpsCount = ops.actionable_count != null
            ? Math.max(0, Number(ops.actionable_count || 0) || 0)
            : pendingCount + retryCount + processingCount + deadLetterCount;
        const reviewOrders = Math.max(0, Number(anomaly.review_orders || 0) || 0);
        const failedOrders = Math.max(0, Number(anomaly.failed_orders || 0) || 0);

        return {
            ready: Boolean(state.summary),
            status: state.loading ? 'loading' : (state.summary ? 'ready' : 'idle'),
            paidRate: Number.isFinite(Number(overview.paid_rate)) ? Number(overview.paid_rate) : null,
            retryCount,
            pendingCount,
            processingCount,
            deadLetterCount,
            actionableOpsCount,
            reviewOrders,
            failedOrders,
            actionableCount: actionableOpsCount + reviewOrders + failedOrders,
            recentItems: getPaymentsCommandCenterRecentItems(data)
        };
    }

    function emitPaymentsCommandCenterSummaryUpdate() {
        if (typeof window.dispatchEvent !== 'function' || typeof CustomEvent !== 'function') {
            return;
        }

        try {
            window.dispatchEvent(new CustomEvent('admin-payments-command-summary-updated', {
                detail: getPaymentsCommandCenterSummary()
            }));
        } catch (_) {
            // Summary sync should never block the payments workbench itself.
        }
    }

    function splitItemsByResolution(items, getStatus) {
        const activeItems = [];
        const resolvedItems = [];

        (items || []).forEach((item) => {
            if (isResolvedAnomalyStatus(getStatus(item))) {
                resolvedItems.push(item);
                return;
            }
            activeItems.push(item);
        });

        return {
            activeItems,
            resolvedItems
        };
    }

    function filterItemsByStatuses(items, statuses) {
        const set = statuses instanceof Set ? statuses : new Set(statuses || []);
        return (items || []).filter((item) => set.has(normalizeStatusValue(item?.ops_status ?? item?.queue_status)));
    }

    function normalizeExceptionTopicFilterKey(topicKey = '') {
        const normalizedTopicKey = String(topicKey || 'all').trim().toLowerCase() || 'all';
        if (PAYMENT_INTENT_EXCEPTION_TOPIC_KEY_SET.has(normalizedTopicKey)) {
            return 'payment_intent_issues';
        }
        return normalizedTopicKey;
    }

    function getExceptionTopicFilterKeys(topicKey = state.exceptionTopicFilter) {
        const normalizedTopicKey = normalizeExceptionTopicFilterKey(topicKey);
        if (normalizedTopicKey === 'payment_intent_issues') {
            return PAYMENT_INTENT_EXCEPTION_TOPIC_KEYS;
        }
        if (normalizedTopicKey === 'all') {
            return [];
        }
        return [normalizedTopicKey];
    }

    function getExceptionTopicFilteredItems(data = state.summary, topicKey = state.exceptionTopicFilter) {
        const items = Array.isArray(data?.exception_topic_items) ? data.exception_topic_items : [];
        const filterKeys = getExceptionTopicFilterKeys(topicKey);
        if (!filterKeys.length) return items;
        const filterKeySet = new Set(filterKeys);
        return items.filter((item) => filterKeySet.has(String(item?.topic_key || '').trim().toLowerCase()));
    }

    function getSeverityLabel(severity) {
        const map = {
            critical: '高危',
            warning: '需跟进',
            info: '提示'
        };
        return map[String(severity || '')] || '提示';
    }

    function getAnomalyOpsStatusLabel(status) {
        const map = {
            pending: '待发送',
            processing: '发送中',
            delivered: '已送达',
            dead_letter: '死信待处理',
            open: '待处理',
            handled: '已处理',
            ignored: '已忽略',
            retry_requested: '已登记重试',
            retry: '等待重试',
            approved: '已审核通过',
            rejected: '已驳回',
            archived: '已归档'
        };
        return map[String(status || '').trim().toLowerCase()] || '待处理';
    }

    function getAnomalyActionLabel(action) {
        const map = {
            mark_handled: '标记已处理',
            ignore: '忽略',
            archive: '归档',
            request_retry: '登记重试',
            reopen: '重新打开',
            approve_review: '审核通过',
            reject_review: '驳回',
            approve_amount_mismatch: '人工放行',
            reject_amount_mismatch: '拒绝入账',
            refund_hupijiao: '执行退款',
            refund_zpay: '执行退款',
            refund_nowpayments: '执行退款',
            query_hupijiao_order: '实时查单',
            query_zpay_order: '实时查单',
            query_nowpayments_order: '实时查单',
            reconcile_hupijiao_order: '人工补单',
            reconcile_zpay_order: '人工补单',
            reconcile_checkout_session: '补回填'
        };
        return map[String(action || '').trim().toLowerCase()] || '执行操作';
    }

    function getOrderActionLabel(action) {
        const map = {
            query_hupijiao_order: '查单',
            query_zpay_order: '查单',
            query_nowpayments_order: '查单',
            refund_hupijiao: '退款',
            refund_zpay: '退款',
            refund_nowpayments: '退款'
        };
        const normalizedAction = String(action || '').trim().toLowerCase();
        return map[normalizedAction] || getAnomalyActionLabel(normalizedAction);
    }

    function getAnomalyActionPrompt(action) {
        const normalizedAction = String(action || '').trim().toLowerCase();
        if (normalizedAction === 'refund_hupijiao' || normalizedAction === 'refund_zpay' || normalizedAction === 'refund_nowpayments') {
            if (normalizedAction === 'refund_nowpayments') {
                return '请填写退款处理备注。NOWPayments 退款会先做官方 Payout 前置条件检查，不会在条件缺失时扣回积分：';
            }
            return normalizedAction === 'refund_zpay'
                ? '请填写退款备注，这条备注会进入后台审计记录，并作为退款原因传给易支付：'
                : '请填写退款备注，这条备注会进入后台审计记录，并作为退款原因传给虎皮椒：';
        }
        if (normalizedAction === 'reconcile_hupijiao_order' || normalizedAction === 'reconcile_zpay_order') {
            return '请填写补单备注，这条备注会进入后台审计记录，并作为这次人工补单的处理说明：';
        }
        return '请填写处理备注，这条备注会进入后台审计记录：';
    }

    function getAnomalyOpsTone(status) {
        const normalized = String(status || '').trim().toLowerCase();
        if (normalized === 'dead_letter') return 'danger';
        if (normalized === 'delivered' || normalized === 'handled' || normalized === 'approved') return 'success';
        if (normalized === 'retry' || normalized === 'retry_requested') return 'warning';
        if (normalized === 'pending' || normalized === 'processing') return 'info';
        if (normalized === 'ignored' || normalized === 'archived') return 'muted';
        if (normalized === 'rejected') return 'danger';
        return 'info';
    }

    function isAnomalyActionLoading(targetType, targetId) {
        const key = `${String(targetType || '').trim().toLowerCase()}:${String(targetId || '').trim()}`;
        return Boolean(state.anomalyActionLoading[key]);
    }

    function getSessionStatusLabel(status) {
        const map = {
            created: '已创建',
            redirect_ready: '待支付',
            completed: '已完成',
            failed: '失败',
            expired: '已过期',
            cancelled: '已取消'
        };
        return map[String(status || '').trim().toLowerCase()] || String(status || '未知');
    }

    function getSessionLinkSourceLabel(linkedBy) {
        const value = String(linkedBy || '').trim().toLowerCase();
        if (!value) return '已匹配';
        if (value.includes('webhook')) return '自动回填';
        if (value.includes('query') || value.includes('claim') || value.includes('fallback')) return '认领兜底';
        return '已匹配';
    }

    function getCheckoutSessionStatusTone(status) {
        const normalized = normalizeStatusValue(status);
        if (normalized === 'completed') return 'success';
        if (normalized === 'redirect_ready' || normalized === 'created') return 'info';
        if (normalized === 'expired' || normalized === 'cancelled') return 'muted';
        if (normalized === 'failed') return 'danger';
        return 'muted';
    }

    function getCheckoutSessionTraceMatchInfo(session) {
        const linkedBy = normalizeStatusValue(session?.linked_by);
        const status = normalizeStatusValue(session?.status);
        const matched = Boolean(session?.payment_order_id);

        if (matched) {
            return {
                label: getSessionLinkSourceLabel(linkedBy),
                tone: linkedBy.includes('query') || linkedBy.includes('claim') || linkedBy.includes('fallback') ? 'warning' : 'success'
            };
        }

        if (status === 'completed') {
            return {
                label: '待回填',
                tone: 'warning'
            };
        }

        if (status === 'failed' || status === 'expired' || status === 'cancelled') {
            return {
                label: '未匹配',
                tone: 'danger'
            };
        }

        return {
            label: '未付款',
            tone: 'muted'
        };
    }

    function getCheckoutSessionTraceDetail(session) {
        const status = normalizeStatusValue(session?.status);
        const matched = Boolean(session?.payment_order_id);
        const errorMessage = String(session?.error_message || '').trim();

        if (matched) {
            return status === 'completed'
                ? '该支付意图已经完成并成功挂到正式订单。'
                : `该支付意图已关联正式订单，当前会话状态：${getSessionStatusLabel(status)}。`;
        }

        if (status === 'redirect_ready') {
            return '二维码/支付页已生成，但用户尚未完成付款或中途关闭。';
        }

        if (status === 'created') {
            return '支付意图已创建，等待进入支付页或生成二维码。';
        }

        if (status === 'completed') {
            return '支付意图已完成，但正式订单还没有回填成功。';
        }

        if (status === 'expired') {
            return '支付意图已过期，用户在有效期内没有完成付款。';
        }

        if (status === 'cancelled') {
            return '支付意图已取消，本次拉起不会继续回填订单。';
        }

        if (status === 'failed') {
            return errorMessage || '支付意图创建或拉起失败，请检查通道配置和支付跳转链路。';
        }

        return errorMessage || '支付意图状态已记录，可结合最近订单和异常队列继续排查。';
    }

    function getCheckoutSessionMatchInfo(order) {
        const linkedBy = String(order?.checkout_session_linked_by || '').trim().toLowerCase();
        const status = String(order?.checkout_session_status || '').trim().toLowerCase();
        const required = Boolean(order?.checkout_session_required);
        const matched = Boolean(order?.checkout_session_matched || order?.checkout_session_id);

        if (matched) {
            return {
                label: getSessionLinkSourceLabel(linkedBy),
                tone: linkedBy.includes('query') || linkedBy.includes('claim') || linkedBy.includes('fallback') ? 'warning' : 'success',
                detail: status ? `会话 ${getSessionStatusLabel(status)}` : '已成功关联支付意图'
            };
        }

        if (required) {
            if (status === 'completed') {
                return {
                    label: '待回填',
                    tone: 'warning',
                    detail: '支付意图已完成，但尚未回填最终订单'
                };
            }

            if (['failed', 'expired', 'cancelled'].includes(status)) {
                return {
                    label: '意图失败',
                    tone: 'danger',
                    detail: `支付意图状态：${getSessionStatusLabel(status)}`
                };
            }

            return {
                label: '待回填',
                tone: 'muted',
                detail: '等待 webhook 或钱包认领阶段完成关联'
            };
        }

        return {
            label: '历史订单',
            tone: 'muted',
            detail: '该订单创建时还未启用支付意图链路'
        };
    }

    function getHandlingSuggestion(item) {
        const title = String(item?.title || '');
        const message = String(item?.message || '');
        const type = String(item?.type || '').trim().toLowerCase();

        if (type === 'ops_alert_job') {
            return '处理建议：先检查 Telegram / 飞书密钥、目标通道配置和网络连通性，再决定是立即重试还是人工处理。';
        }
        if (type === 'shop_profit_audit') {
            const actionLabel = String(item?.action_label || '').trim();
            return actionLabel
                ? `处理建议：进入商城净利润审计，${actionLabel}，再回到运营入口确认告警是否收口。`
                : '处理建议：进入商城净利润审计，核对订单收入、采购成本和积分来源后再确认净利润口径。';
        }
        if (title.includes('退款积分回滚失败')) {
            return '处理建议：立即核对 payment_orders、payment_events 与 points_ledger，确认是否需要人工补回积分并暂停继续退款。';
        }
        if (title.includes('退款积分扣回失败')) {
            return '处理建议：先检查用户当前余额、扣回 RPC 是否已部署，再决定是否改走人工售后或人工扣回。';
        }
        if (title.includes('退款失败')) {
            return '处理建议：复核通道返回、网关订单状态与后台补回记录，避免重复退款或重复扣回。';
        }
        if (type === 'query' || title.includes('查码')) {
            return '处理建议：先判断是用户输错订单号，还是 webhook 未落单、订单被拦截或兑换码尚未生成。';
        }
        if (title.includes('支付意图') || type === 'session') {
            if (title.includes('待回填')) {
                return '处理建议：先检查支付入口是否成功创建，再核对 webhook 是否到达；必要时引导用户查码认领兜底。';
            }
            if (title.includes('已完成但未回填')) {
                return '处理建议：优先检查 provider_order_no 与 checkout session 的关联是否丢失，再决定是否人工回填。';
            }
            return '处理建议：检查支付通道拉起参数、支付跳转结果以及 checkout session 状态。';
        }
        if (title.includes('重复回调')) {
            return '处理建议：确认是否只是重复通知，还是已经触发重复写单、重复回填或重复入账。';
        }
        if (title.includes('签名') || message.toLowerCase().includes('signature')) {
            return '处理建议：检查支付通道密钥、回调签名算法和回调来源地址。';
        }
        if (title.includes('金额') || message.includes('金额')) {
            return '处理建议：核对套餐价格、支付金额和通道回传金额是否一致，金额异常放行前务必补处理备注。';
        }
        if (title.includes('未认领') || message.includes('未输入订单号')) {
            return '处理建议：提醒用户在钱包输入订单号，或后台人工补认领。';
        }
        if (title.includes('待审核')) {
            return '处理建议：检查套餐映射、金额校验和订单来源后再决定是否放行。';
        }
        return '处理建议：先核对订单号、支付通道配置和回调时间，再决定是否人工补单。';
    }

    function getAnomalyTypeLabel(item) {
        if (item?.type === 'ops_alert_job') return '站外告警';
        if (item?.type === 'shop_profit_audit') return '商城利润审计';
        if (item?.type === 'session') return '支付意图';
        if (item?.type === 'event') return '回调事件';
        if (item?.type === 'query') return '查码记录';
        return '订单';
    }

    function getAnomalyReferenceLabel(item) {
        if (item?.type === 'shop_profit_audit') return '审计项';
        if (item?.type === 'ops_alert_job') return '投递单';
        return item?.type === 'session' ? '会话' : '订单号';
    }

    function getAnomalyReferenceValue(item) {
        if (item?.type === 'shop_profit_audit') {
            return getShopProfitAuditTargetLabel(item?.audit_alert_type || item?.provider_order_no || item?.id);
        }
        if (item?.type === 'ops_alert_job') {
            return item?.provider_order_no || item?.id || '无投递单号';
        }
        if (item?.type === 'session') {
            return item.session_key || item.provider_order_no || '无会话号';
        }
        return item?.provider_order_no || '无订单号';
    }

    function getPaymentInitiatorEmailLabel(item) {
        const email = String(item?.user_email || '').trim();
        if (email) return email;

        const userId = String(item?.user_id || '').trim();
        return userId ? '未绑定邮箱' : '匿名 / 未识别用户';
    }

    function renderPaymentInitiatorMeta(item) {
        if (String(item?.type || '').trim().toLowerCase() !== 'session') {
            return '';
        }

        return `<span><small>发起人邮箱</small><strong>${escapeHtml(getPaymentInitiatorEmailLabel(item))}</strong></span>`;
    }

    function renderAnomalyOpsState(item) {
        const status = String(item?.ops_status || 'open').trim().toLowerCase();
        const tone = getAnomalyOpsTone(status);
        const label = getAnomalyOpsStatusLabel(status);
        const resolution = String(item?.ops_resolution || '').trim();
        const actionTime = item?.ops_last_action_at ? formatDateTime(item.ops_last_action_at) : '';

        return `
            <div class="payments-anomaly-ops">
                <span class="payments-anomaly-state ${escapeHtml(`status-${status}`)} ${escapeHtml(tone)}">${escapeHtml(label)}</span>
                ${resolution ? `<span class="payments-anomaly-resolution">${escapeHtml(resolution)}</span>` : ''}
                ${actionTime ? `<span class="payments-anomaly-resolution-meta">最近处理：${escapeHtml(actionTime)}</span>` : ''}
            </div>
        `;
    }

    function renderAnomalyActions(item) {
        const actions = Array.isArray(item?.ops_available_actions) ? item.ops_available_actions : [];
        if (!actions.length) return '';

        const loading = isAnomalyActionLoading(item.type, item.id);
        return `
            <div class="payments-anomaly-actions">
                ${actions.map((action) => `
                    <button
                        type="button"
                        class="payments-anomaly-action-btn ${escapeHtml(action)}"
                        data-admin-action="payments-handle-anomaly-action"
                        data-payments-target-type="${escapeHtml(item.type)}"
                        data-payments-target-id="${escapeHtml(item.id)}"
                        data-payments-action="${escapeHtml(action)}"
                        ${loading ? 'disabled' : ''}
                    >
                        ${escapeHtml(getAnomalyActionLabel(action))}
                    </button>
                `).join('')}
            </div>
        `;
    }

    function renderMiniCountBadge(label, count, tone = 'muted') {
        if (!Number(count || 0)) return '';
        return `<span class="payments-mini-badge ${escapeHtml(tone)}">${escapeHtml(label)} ${escapeHtml(formatNumber(count))}</span>`;
    }

    function renderCollapsedHandledSection(config) {
        const title = String(config?.title || '已处理').trim() || '已处理';
        const description = String(config?.description || '').trim();
        const body = String(config?.body || '').trim();
        const badges = Array.isArray(config?.badges) ? config.badges.filter(Boolean).join('') : '';
        const actionButton = String(config?.actionButton || '').trim();

        if (!body) return '';

        return `
            <details class="payments-handled-group">
                <summary class="payments-handled-group-summary">
                    <div class="payments-handled-group-summary-copy">
                        <div class="payments-handled-group-summary-title">
                            <i class="fas fa-box-archive"></i>
                            <span>${escapeHtml(title)}</span>
                        </div>
                        ${description ? `<div class="payments-handled-group-summary-desc">${escapeHtml(description)}</div>` : ''}
                    </div>
                    <div class="payments-handled-group-summary-meta">
                        ${badges}
                        ${actionButton}
                        <span class="payments-handled-group-summary-action">
                            <span>展开查看</span>
                            <i class="fas fa-chevron-down"></i>
                        </span>
                    </div>
                </summary>
                <div class="payments-handled-group-body">
                    ${body}
                </div>
            </details>
        `;
    }

    function renderOpsAlertQueueItemMeta(item) {
        if (String(item?.type || '').trim().toLowerCase() === 'shop_profit_audit') {
            const actionLabel = String(item?.action_label || '').trim() || '复核净利润口径';
            return `
                <div class="payments-anomaly-meta">
                    <span><small>类型</small><strong>商城利润审计</strong></span>
                    <span><small>指标</small><strong>${escapeHtml(item.audit_metric || '待复核')}</strong></span>
                    <span><small>影响订单</small><strong>${escapeHtml(formatNumber(item.affected_order_count || 0))}</strong></span>
                    <span><small>处理项</small><strong>${escapeHtml(actionLabel)}</strong></span>
                    <span><small>${escapeHtml(getAnomalyReferenceLabel(item))}</small><strong>${escapeHtml(getAnomalyReferenceValue(item))}</strong></span>
                    <span><small>时间</small><strong>${escapeHtml(formatDateTime(item.created_at))}</strong></span>
                </div>
            `;
        }

        return `
            <div class="payments-anomaly-meta">
                <span><small>渠道</small><strong>${escapeHtml((Array.isArray(item.channels) ? item.channels : []).map(getOpsAlertChannelLabel).join(' / ') || '未配置')}</strong></span>
                <span><small>剩余</small><strong>${escapeHtml((Array.isArray(item.remaining_channels) ? item.remaining_channels : []).map(getOpsAlertChannelLabel).join(' / ') || '无')}</strong></span>
                <span><small>尝试</small><strong>${escapeHtml(`${formatNumber(item.attempt_count || 0)} / ${formatNumber(item.max_attempts || 0)}`)}</strong></span>
                <span><small>${escapeHtml(getAnomalyReferenceLabel(item))}</small><strong>${escapeHtml(getAnomalyReferenceValue(item))}</strong></span>
                <span><small>下次重试</small><strong>${escapeHtml(formatDateTime(item.next_retry_at))}</strong></span>
                <span><small>时间</small><strong>${escapeHtml(formatDateTime(item.created_at))}</strong></span>
            </div>
        `;
    }

    function getOpsAlertQueueItemBadgeLabel(item) {
        if (String(item?.type || '').trim().toLowerCase() === 'shop_profit_audit') {
            return getSeverityLabel(item.severity || 'warning');
        }
        return getAnomalyOpsStatusLabel(item.queue_status);
    }

    function renderOpsAlertQueueItemsHtml(items) {
        return (items || []).map((item) => `
            <div class="payments-anomaly-item severity-${escapeHtml(item.severity || 'warning')}">
                <div class="payments-anomaly-top">
                    <div class="payments-anomaly-copy">
                        <div class="payments-anomaly-title">${escapeHtml(item.title || '站外告警')}</div>
                        <div class="payments-anomaly-message">${escapeHtml(item.message || '')}</div>
                    </div>
                    <span class="payments-anomaly-severity">${escapeHtml(getOpsAlertQueueItemBadgeLabel(item))}</span>
                </div>
                ${renderAnomalyOpsState(item)}
                <div class="payments-anomaly-suggestion">
                    <i class="fas fa-lightbulb"></i>
                    <span>${escapeHtml(getHandlingSuggestion(item))}</span>
                </div>
                ${renderOpsAlertQueueItemMeta(item)}
                ${renderAnomalyActions(item)}
            </div>
        `).join('');
    }

    function renderExceptionTopicItemsHtml(items) {
        return (items || []).map((item) => `
            <div class="payments-anomaly-item severity-${escapeHtml(item.severity || 'info')}">
                <div class="payments-anomaly-top">
                    <div class="payments-anomaly-copy">
                        <div class="payments-anomaly-title">${escapeHtml(item.title || '专题项')}</div>
                        <div class="payments-anomaly-message">${escapeHtml(item.message || '')}</div>
                    </div>
                    <span class="payments-anomaly-severity">${escapeHtml(getSeverityLabel(item.severity))}</span>
                </div>
                ${item.type === 'query' ? '' : renderAnomalyOpsState(item)}
                <div class="payments-anomaly-suggestion">
                    <i class="fas fa-lightbulb"></i>
                    <span>${escapeHtml(getHandlingSuggestion(item))}</span>
                </div>
                <div class="payments-anomaly-meta">
                    <span><small>专题</small><strong>${escapeHtml(item.topic_label || '支付异常')}</strong></span>
                    <span><small>通道</small><strong>${escapeHtml(getProviderLabel(item.provider))}</strong></span>
                    ${renderPaymentInitiatorMeta(item)}
                    <span><small>${escapeHtml(getAnomalyReferenceLabel(item))}</small><strong>${escapeHtml(getAnomalyReferenceValue(item))}</strong></span>
                    <span><small>时间</small><strong>${escapeHtml(formatDateTime(item.created_at))}</strong></span>
                </div>
                ${renderAnomalyActions(item)}
            </div>
        `).join('');
    }

    function renderOrderActions(order) {
        const actions = Array.isArray(order?.order_available_actions) ? order.order_available_actions : [];
        if (!actions.length) {
            return '<span class="payments-text-muted">—</span>';
        }

        const loading = isAnomalyActionLoading('order', order.id);
        return `
            <div class="payments-anomaly-actions payments-order-actions">
                ${actions.map((action) => `
                    <button
                        type="button"
                        class="payments-anomaly-action-btn ${escapeHtml(action)}"
                        data-admin-action="payments-handle-anomaly-action"
                        data-payments-target-type="order"
                        data-payments-target-id="${escapeHtml(order.id || '')}"
                        data-payments-action="${escapeHtml(action)}"
                        ${loading ? 'disabled' : ''}
                    >
                        ${escapeHtml(getOrderActionLabel(action))}
                    </button>
                `).join('')}
            </div>
        `;
    }

    function buildPaymentsOpenUserDetailAttrs(userId = '') {
        const safeUserId = String(userId || '').trim();
        if (!safeUserId) {
            return '';
        }

        return `data-admin-action="analytics-open-user-detail" data-user-id="${escapeHtml(encodeURIComponent(safeUserId))}"`;
    }

    function getPaymentsOrderUserLabel(order = {}) {
        const userEmail = String(order?.user_email || '').trim();
        if (userEmail) {
            return userEmail;
        }
        if (String(order?.user_id || '').trim()) {
            return '未绑定邮箱';
        }
        return '未认领';
    }

    function renderPaymentsOrderUser(order = {}) {
        const label = getPaymentsOrderUserLabel(order);
        const userId = String(order?.user_id || '').trim();

        if (!userId) {
            return `<span class="payments-user-text is-muted">${escapeHtml(label)}</span>`;
        }

        return `
            <button
                type="button"
                class="payments-user-link"
                ${buildPaymentsOpenUserDetailAttrs(userId)}
                title="查看用户信息卡"
                aria-label="查看 ${escapeHtml(label)} 的用户信息卡"
            >
                ${escapeHtml(label)}
            </button>
        `;
    }

    function formatCompactOrderNo(value = '') {
        const text = String(value || '').trim();
        if (!text) {
            return '—';
        }
        if (text.length <= 18) {
            return text;
        }
        return `${text.slice(0, 8)}...${text.slice(-6)}`;
    }

    function renderPaymentsOrderNo(order = {}) {
        const orderNo = String(order?.provider_order_no || '').trim();
        if (!orderNo) {
            return '<span class="payments-order-no payments-order-no--empty">—</span>';
        }

        return `
            <button
                type="button"
                class="payments-order-no payments-order-copy-btn"
                data-admin-action="payments-copy-order-no"
                data-payments-order-no="${escapeHtml(encodeURIComponent(orderNo))}"
                title="点击复制完整订单号"
                aria-label="复制订单号"
            >
                ${escapeHtml(formatCompactOrderNo(orderNo))}
            </button>
        `;
    }

    function decodePaymentsActionValue(value = '') {
        const raw = String(value || '').trim();
        if (!raw) {
            return '';
        }
        try {
            return decodeURIComponent(raw);
        } catch (_) {
            return raw;
        }
    }

    async function copyTextToClipboard(text = '') {
        const value = String(text || '').trim();
        if (!value) {
            throw new Error('没有可复制的内容');
        }

        if (typeof navigator !== 'undefined' && navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(value);
            return true;
        }

        if (typeof document === 'undefined' || !document.createElement || !document.body) {
            throw new Error('当前浏览器不支持剪贴板写入');
        }

        const helper = document.createElement('textarea');
        helper.value = value;
        helper.setAttribute('readonly', '');
        helper.style.position = 'fixed';
        helper.style.left = '-9999px';
        helper.style.top = '0';
        document.body.appendChild(helper);
        helper.select();

        let copied = false;
        try {
            copied = document.execCommand?.('copy') === true;
        } finally {
            document.body.removeChild(helper);
        }

        if (!copied) {
            throw new Error('复制失败');
        }
        return true;
    }

    async function copyOrderNo(encodedOrderNo = '') {
        const orderNo = decodePaymentsActionValue(encodedOrderNo);
        try {
            await copyTextToClipboard(orderNo);
            window.showToast?.('订单号已复制', 'success');
            return true;
        } catch (error) {
            console.warn('[AdminPayments] Failed to copy order number:', error);
            window.showToast?.('订单号复制失败，请手动复制。', 'error');
            return false;
        }
    }

    function getRangeLabel(days) {
        const num = Number(days || state.days || 30);
        const labels = {
            7: '最近 7 天',
            30: '最近 30 天',
            90: '最近 90 天',
            365: '最近 1 年'
        };
        return labels[num] || `最近 ${num} 天`;
    }

    function getCurrentCacheKey() {
        const site = getSiteParam() || 'all';
        if (state.rangeMode === 'custom' && state.customStartDate && state.customEndDate) {
            return `custom:${state.customStartDate}:${state.customEndDate}:${site}`;
        }
        return `preset:${state.days}:${site}`;
    }

    function clearTabPrefetch() {
        if (!state.tabPrefetchHandle) {
            return;
        }

        if (state.tabPrefetchMode === 'idle' && typeof window.cancelIdleCallback === 'function') {
            window.cancelIdleCallback(state.tabPrefetchHandle);
        } else {
            window.clearTimeout(state.tabPrefetchHandle);
        }

        state.tabPrefetchHandle = 0;
        state.tabPrefetchMode = '';
    }

    function prefetchTabData(tabId, options = {}) {
        const normalizedTab = String(tabId || 'overview').trim().toLowerCase() || 'overview';
        const force = options.force === true;
        const cacheKey = getCurrentCacheKey();
        const taskKey = `${normalizedTab}:${cacheKey}:${force ? 'force' : 'warm'}`;

        if (!force && hasCachedDataForTab(normalizedTab)) {
            return Promise.resolve(false);
        }

        if (!force && state.tabPrefetchPromise && state.tabPrefetchTaskKey === taskKey) {
            return state.tabPrefetchPromise;
        }

        const run = async () => {
            const query = buildSummaryQuery(normalizedTab, { prefetch: !force });
            const payload = await fetchAdminJson(`/api/admin/payments/summary?${query.toString()}`);

            if (cacheKey !== getCurrentCacheKey()) {
                return false;
            }

            mergeSummaryPayload(payload, { sourceTab: normalizedTab });
            state.viewCache[normalizedTab] = cacheKey;

            return true;
        };

        if (force) {
            return run();
        }

        state.tabPrefetchTaskKey = taskKey;
        state.tabPrefetchPromise = run().finally(() => {
            if (state.tabPrefetchTaskKey === taskKey) {
                state.tabPrefetchTaskKey = '';
                state.tabPrefetchPromise = null;
            }
        });
        return state.tabPrefetchPromise;
    }

    function getAutoPrefetchTabs(activeTab = state.activeTab) {
        void activeTab;
        // Payment tabs fan out into orders, events, sessions, queries, and ledger scans.
        // Keep sibling tabs fully on demand; overview already performs its own staged load.
        return PAYMENTS_PREFETCH_TABS;
    }

    function scheduleTabPrefetch(activeTab = state.activeTab) {
        const normalizedTab = String(activeTab || state.activeTab || 'overview').trim().toLowerCase() || 'overview';
        const siblingTabs = getAutoPrefetchTabs(normalizedTab);
        const scheduledCacheKey = getCurrentCacheKey();

        clearTabPrefetch();

        if (!isPaymentsModuleActive() || siblingTabs.length === 0) {
            return false;
        }

        const runPrefetch = async () => {
            state.tabPrefetchHandle = 0;
            state.tabPrefetchMode = '';

            if (!isPaymentsModuleActive() || scheduledCacheKey !== getCurrentCacheKey()) {
                return;
            }

            for (const tabId of siblingTabs) {
                if (!isPaymentsModuleActive() || scheduledCacheKey !== getCurrentCacheKey()) {
                    break;
                }

                try {
                    await prefetchTabData(tabId);
                } catch (error) {
                    console.warn(`[AdminPayments] Failed to prefetch ${tabId} tab:`, error);
                }
            }
        };

        if (typeof window.requestIdleCallback === 'function') {
            state.tabPrefetchMode = 'idle';
            state.tabPrefetchHandle = window.requestIdleCallback(runPrefetch, { timeout: 2400 });
            return true;
        }

        state.tabPrefetchMode = 'timeout';
        state.tabPrefetchHandle = window.setTimeout(runPrefetch, 600);
        return true;
    }

    function resetViewState() {
        clearTabPrefetch();
        state.viewCache = {};
        state.cleanupPreview = null;
        state.businessBreakdownFocusKey = 'all';
        state.businessBreakdownHoverIndex = null;
        state.pointsBreakdownFocusKey = 'all';
        state.pointsBreakdownHoverIndex = null;
        state.pagination = {
            anomalies: 1,
            sessions: 1,
            orders: 1,
            cleanupOrders: 1,
            cleanupUsers: 1
        };
    }

    function syncCustomRangeInputs() {
        ensureRangeDefaults();
        const startInput = document.getElementById('paymentsCustomStartDate');
        const endInput = document.getElementById('paymentsCustomEndDate');
        if (startInput) startInput.value = state.customStartDate || '';
        if (endInput) endInput.value = state.customEndDate || '';
    }

    function paginateItems(items, pageKey, pageSize = PAYMENTS_PAGE_SIZE) {
        const list = Array.isArray(items) ? items : [];
        const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
        const requestedPage = Number(state.pagination?.[pageKey] || 1);
        const currentPage = Math.min(Math.max(1, requestedPage), totalPages);

        state.pagination[pageKey] = currentPage;

        const start = (currentPage - 1) * pageSize;
        return {
            pageItems: list.slice(start, start + pageSize),
            currentPage,
            totalPages,
            totalItems: list.length
        };
    }

    function matchesFocusedOrder(order = {}, focusOrderId = state.focusOrderId) {
        const normalizedFocusOrderId = String(focusOrderId || '').trim();
        if (!normalizedFocusOrderId) return false;
        return [order?.id, order?.provider_order_no]
            .map((value) => String(value || '').trim())
            .filter(Boolean)
            .includes(normalizedFocusOrderId);
    }

    function getFocusedOrderIndex(orders = [], focusOrderId = state.focusOrderId) {
        return (Array.isArray(orders) ? orders : []).findIndex((order) => matchesFocusedOrder(order, focusOrderId));
    }

    function scrollFocusedOrderIntoView() {
        const schedule = typeof window.requestAnimationFrame === 'function'
            ? window.requestAnimationFrame.bind(window)
            : ((callback) => window.setTimeout(callback, 16));
        schedule(() => {
            const focused = document.querySelector('[data-payments-focused-order="1"]');
            if (focused instanceof HTMLElement && typeof focused.scrollIntoView === 'function') {
                focused.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        });
    }

    function renderPager(pageKey, currentPage, totalPages, totalItems) {
        if (totalItems <= PAYMENTS_PAGE_SIZE) return '';

        return `
            <div class="payments-pagination admin-pagination">
                <button class="payments-pagination-btn page-btn" type="button" data-admin-action="payments-go-to-page" data-payments-page-key="${escapeHtml(pageKey)}" data-payments-page="${currentPage - 1}" ${currentPage <= 1 ? 'disabled' : ''} aria-label="上一页">
                    <i class="fas fa-chevron-left"></i>
                </button>
                <div class="payments-pagination-info page-info">第 ${escapeHtml(formatNumber(currentPage))} / ${escapeHtml(formatNumber(totalPages))} 页 · 共 ${escapeHtml(formatNumber(totalItems))} 条</div>
                <button class="payments-pagination-btn page-btn" type="button" data-admin-action="payments-go-to-page" data-payments-page-key="${escapeHtml(pageKey)}" data-payments-page="${currentPage + 1}" ${currentPage >= totalPages ? 'disabled' : ''} aria-label="下一页">
                    <i class="fas fa-chevron-right"></i>
                </button>
            </div>
        `;
    }

    async function getAccessToken() {
        if (window.AdminApi?.getAccessToken) {
            try {
                const accessToken = await window.AdminApi.getAccessToken();
                if (accessToken) {
                    return String(accessToken).trim();
                }
            } catch (_) {
                // Fall through to runtime auth lookup.
            }
        }

        const client = window.supabaseClient;
        if (!client) return '';

        if (typeof client.accessToken === 'function') {
            try {
                const accessToken = await Promise.race([
                    Promise.resolve().then(() => client.accessToken()),
                    new Promise((resolve) => {
                        window.setTimeout(() => resolve(''), 1800);
                    })
                ]);
                if (accessToken) {
                    return String(accessToken).trim();
                }
            } catch (_) {
                // Fall through to direct auth session lookup.
            }
        }

        if (client.auth?.getSession) {
            try {
                const sessionResult = await Promise.race([
                    Promise.resolve().then(() => client.auth.getSession()),
                    new Promise((resolve) => {
                        window.setTimeout(() => resolve(null), 1800);
                    })
                ]);
                return String(sessionResult?.data?.session?.access_token || '').trim();
            } catch (_) {
                return '';
            }
        }

        return '';
    }

    async function fetchAdminJson(url, options = {}) {
        const baseHeaders = {
            ...(options.headers || {})
        };

        if (options.body && !baseHeaders['Content-Type']) {
            baseHeaders['Content-Type'] = 'application/json';
        }

        const requestInit = window.AdminApi?.buildRequestInit
            ? await window.AdminApi.buildRequestInit({
                ...options,
                headers: baseHeaders
            })
            : (() => {
                const fallbackInit = {
                    ...options,
                    headers: baseHeaders
                };

                return fallbackInit;
            })();

        const response = await fetch(url, requestInit);

        let rawText = '';
        let payload = {};

        if (typeof response?.text === 'function') {
            rawText = await response.text().catch(() => '');
            if (rawText) {
                try {
                    payload = JSON.parse(rawText);
                } catch (_) {
                    payload = {
                        rawText: String(rawText || '').trim()
                    };
                }
            }
        } else if (typeof response?.json === 'function') {
            payload = await response.json().catch(() => ({}));
        }

        if (!response.ok || payload?.success === false) {
            const fallbackMessage = payload?.rawText
                || `${response.status ? `请求失败（HTTP ${response.status}）` : '请求失败'}`;
            const error = new Error(payload?.message || fallbackMessage);
            error.statusCode = response.status;
            if (payload?.rawText) {
                error.rawText = payload.rawText;
            }
            throw error;
        }

        return payload;
    }

    function mergeSummaryPayload(payload, options = {}) {
        const incoming = payload && typeof payload === 'object' && !Array.isArray(payload)
            ? { ...payload }
            : {};
        const sourceTab = String(options.sourceTab || state.activeTab || 'overview').trim().toLowerCase() || 'overview';
        const hasWarmOpsCache = state.viewCache.ops === getCurrentCacheKey()
            && Array.isArray(state.summary?.recent_anomalies)
            && Array.isArray(state.summary?.recent_orders);

        if (sourceTab !== 'overview') {
            delete incoming.overview_scope;
            delete incoming.overview;
            delete incoming.session_summary;
            delete incoming.query_summary;
            delete incoming.anomaly_summary;
            delete incoming.provider_stats;
            delete incoming.trend_24h;
            delete incoming.refund_alert_topics;
            delete incoming.refund_alert_items;
        }

        if (sourceTab !== 'ops') {
            delete incoming.exception_topics;
            delete incoming.exception_topic_items;
            delete incoming.recent_anomalies;
            delete incoming.recent_checkout_sessions;
            delete incoming.recent_orders;

            if (hasWarmOpsCache) {
                delete incoming.ops_alert_summary;
                delete incoming.ops_alert_items;
            } else if (incoming.ops_alert_summary == null && state.summary?.ops_alert_summary && typeof state.summary.ops_alert_summary === 'object') {
                delete incoming.ops_alert_summary;
            }

            if (!hasWarmOpsCache && incoming.ops_alert_items == null && Array.isArray(state.summary?.ops_alert_items)) {
                delete incoming.ops_alert_items;
            }
        }

        if (options.replace === true) {
            const preservedOpsPayload = sourceTab !== 'ops' && hasWarmOpsCache
                ? {
                    ops_alert_summary: state.summary?.ops_alert_summary,
                    ops_alert_items: state.summary?.ops_alert_items,
                    exception_topics: state.summary?.exception_topics,
                    exception_topic_items: state.summary?.exception_topic_items,
                    recent_anomalies: state.summary?.recent_anomalies,
                    recent_checkout_sessions: state.summary?.recent_checkout_sessions,
                    recent_orders: state.summary?.recent_orders
                }
                : {};
            state.summary = {
                ...incoming,
                ...Object.fromEntries(
                    Object.entries(preservedOpsPayload).filter(([, value]) => value !== undefined)
                )
            };
            emitPaymentsCommandCenterSummaryUpdate();
            return state.summary;
        }

        state.summary = {
            ...(state.summary || {}),
            ...incoming
        };

        emitPaymentsCommandCenterSummaryUpdate();
        return state.summary;
    }

    function hasCachedDataForTab(tabId) {
        const normalizedTab = String(tabId || 'overview');
        if (state.viewCache[normalizedTab] !== getCurrentCacheKey()) {
            return false;
        }

        const data = state.summary || {};
        if (normalizedTab === 'overview') {
            return Boolean(data.overview) && Array.isArray(data.provider_stats);
        }
        if (normalizedTab === 'finance') {
            return Boolean(data.sitewide_summary)
                && Array.isArray(data.business_breakdown)
                && Array.isArray(data.points_breakdown);
        }
        if (normalizedTab === 'ops') {
            return Array.isArray(data.recent_anomalies) && Array.isArray(data.recent_orders);
        }
        return false;
    }

    async function ensureAdminAccess() {
        if (window.isAdmin) return true;
        if (typeof window.loadUserPermissions === 'function') {
            await window.loadUserPermissions();
        }
        return Boolean(window.isAdmin);
    }

    function getSiteParam() {
        return window.AdminSiteFilter?.getSiteParam?.() || null;
    }

    function buildSummaryQuery(view = state.activeTab, options = {}) {
        const query = new URLSearchParams({
            view: String(view || state.activeTab || 'overview')
        });
        if (options.prefetch === true) {
            query.set('prefetch', '1');
        }
        if (options.scope) {
            query.set('scope', String(options.scope).trim().toLowerCase());
        }
        const site = getSiteParam();
        if (site) {
            query.set('site', site);
        }

        if (state.rangeMode === 'custom' && state.customStartDate && state.customEndDate) {
            const startIso = toRangeIso(state.customStartDate, false);
            const endIso = toRangeIso(state.customEndDate, true);
            if (startIso && endIso) {
                query.set('startDate', startIso);
                query.set('endDate', endIso);
                return query;
            }
        }

        query.set('days', String(state.days));
        return query;
    }

    function isOverviewCorePayload(data = state.summary) {
        return state.activeTab === 'overview'
            && (
                state.overviewStage === 'core'
                || String(data?.overview_scope || '').trim().toLowerCase() === 'core'
            );
    }

    function isOverviewIssuePayloadPending(data = state.summary) {
        if (state.activeTab !== 'overview') return false;
        const stage = String(state.overviewStage || '').trim().toLowerCase();
        if (stage && stage !== 'full' && stage !== 'idle') return true;
        return String(data?.overview_scope || '').trim().toLowerCase() === 'core';
    }

    function syncOverviewStage() {
        if (state.activeTab !== 'overview') {
            state.overviewStage = 'idle';
            return;
        }

        if (state.overviewSecondaryLoaded && state.overviewOpsLoaded) {
            state.overviewStage = 'full';
            return;
        }

        if (state.overviewSecondaryLoaded || state.overviewOpsLoaded) {
            state.overviewStage = 'partial';
            return;
        }

        state.overviewStage = 'core';
    }

    function updateOverviewLoadingMeta() {
        if (state.activeTab !== 'overview') return;
        if (state.overviewStage === 'full') return;

        if (state.overviewSecondaryLoaded && !state.overviewOpsLoaded) {
            setToolbarMeta('趋势与退款专题已加载，正在补充联动摘要…', 'info');
            return;
        }

        if (!state.overviewSecondaryLoaded && state.overviewOpsLoaded) {
            setToolbarMeta('联动摘要已同步，正在补充趋势与退款专题…', 'info');
            return;
        }

        setToolbarMeta('首屏摘要已加载，正在并行补充趋势与专题…', 'info');
    }

    function isPaymentsModuleActive() {
        const module = document.getElementById('module-payments');
        return Boolean(module && module.classList.contains('active') && window.getComputedStyle(module).display !== 'none');
    }

    function syncAutoRefreshToggle() {
        const toggle = document.getElementById('paymentsAutoRefreshToggle');
        if (!toggle) return;
        toggle.checked = Boolean(state.autoRefreshEnabled);
        const wrapper = toggle.closest('.auto-refresh-toggle');
        if (wrapper) {
            wrapper.title = `自动刷新（${Math.round(state.autoRefreshIntervalMs / 60000)} 分钟）`;
        }
    }

    function stopAutoRefresh() {
        if (state.autoRefreshTimer) {
            clearInterval(state.autoRefreshTimer);
            state.autoRefreshTimer = null;
        }
    }

    function startAutoRefresh() {
        if (!state.autoRefreshEnabled || state.autoRefreshTimer) return;
        state.autoRefreshTimer = window.setInterval(() => {
            if (!state.initialized || state.loading || !isPaymentsModuleActive()) return;
            reload({ silent: true });
        }, state.autoRefreshIntervalMs);
    }

    function setAutoRefreshEnabled(enabled) {
        state.autoRefreshEnabled = Boolean(enabled);
        localStorage.setItem('paymentsAutoRefreshEnabled', state.autoRefreshEnabled ? '1' : '0');
        syncAutoRefreshToggle();
        if (state.autoRefreshEnabled) {
            startAutoRefresh();
        } else {
            stopAutoRefresh();
        }
    }

    function setToolbarMeta(text, tone = 'muted') {
        const target = document.getElementById('paymentsToolbarMeta');
        if (!target) return;
        target.textContent = text || '';
        target.dataset.tone = tone;
        target.parentElement?.classList.toggle('is-loading', tone === 'info');
    }

    function updateLastSynced(dateLike = new Date()) {
        state.lastSyncedAt = dateLike instanceof Date ? dateLike.toISOString() : dateLike;
        setToolbarMeta(`上次刷新 ${formatToolbarTime(state.lastSyncedAt)}`, 'ready');
    }

    function updateRangeLabel() {
        const currentLabel = getCurrentRangeLabel();
        const label = document.getElementById('paymentsRangeLabel');
        if (label) {
            label.textContent = currentLabel;
        }

        const rangeMeta = document.getElementById('paymentsRangeMeta');
        if (rangeMeta) {
            rangeMeta.innerHTML = `
                <i class="fas fa-calendar-day"></i>
                <span>当前范围：${escapeHtml(currentLabel)}</span>
            `;
        }

        document.querySelectorAll('.payments-range-btn').forEach((button) => {
            const buttonDays = Number(button.dataset.days || 0);
            button.classList.toggle('active', state.rangeMode === 'preset' && buttonDays === state.days);
        });

        syncCustomRangeInputs();
    }

    function closeRangeMenu() {
        const dropdown = document.getElementById('paymentsRangeDropdown');
        if (dropdown) {
            dropdown.classList.remove('open');
        }
    }

    function toggleRangeMenu(event) {
        if (event) event.stopPropagation();
        const dropdown = document.getElementById('paymentsRangeDropdown');
        if (!dropdown) return;
        syncCustomRangeInputs();
        dropdown.classList.toggle('open');
    }

    function updateToolbarHighlights(data) {
        const target = document.getElementById('paymentsToolbarHighlights');
        if (!target) return;

        const isCoreOverview = isOverviewCorePayload(data);
        const isIssuePending = isOverviewIssuePayloadPending(data);
        const overview = data?.overview || {};
        const anomaly = data?.anomaly_summary || {};
        const sitewide = data?.sitewide_summary || {};
        const sessionSummary = data?.session_summary || {};
        const providerCount = Array.isArray(data?.provider_stats) ? data.provider_stats.length : 0;
        const refundIssueCount = getRefundIssueCount(data);
        const anomalyCount = getOverviewIssueCount(data);
        const incomeValue = sitewide.recharge_amount != null
            ? sitewide.recharge_amount
            : overview.total_amount;
        const hasSessionSummary = Number(sessionSummary.total_sessions || 0) > 0;

        target.innerHTML = `
            <div class="payments-highlight-pill">
                <i class="fas ${hasSessionSummary ? 'fa-link' : 'fa-credit-card'}"></i>
                <span>${hasSessionSummary ? `匹配 ${escapeHtml(formatPercent(sessionSummary.order_match_rate || sessionSummary.match_rate))}` : `通道 ${escapeHtml(formatNumber(providerCount))}`}</span>
            </div>
            <div class="payments-highlight-pill">
                <i class="fas fa-circle-check"></i>
                <span>成功率 ${escapeHtml(formatPercent(overview.paid_rate))}</span>
            </div>
            <div class="payments-highlight-pill ${!isIssuePending && anomalyCount > 0 ? 'warning' : ''}">
                <i class="fas fa-triangle-exclamation"></i>
                <span>${isIssuePending ? '异常补充中' : `异常 ${escapeHtml(formatNumber(anomalyCount))}`}</span>
            </div>
            ${isIssuePending ? `
                <div class="payments-highlight-pill">
                    <i class="fas fa-rotate-left"></i>
                    <span>退款补充中</span>
                </div>
            ` : refundIssueCount > 0 ? `
                <div class="payments-highlight-pill warning">
                    <i class="fas fa-rotate-left"></i>
                    <span>退款异常 ${escapeHtml(formatNumber(refundIssueCount))}</span>
                </div>
            ` : ''}
            <div class="payments-highlight-pill">
                <i class="fas fa-wallet"></i>
                <span>收入 ${escapeHtml(formatCurrency(incomeValue))}</span>
            </div>
        `;
    }

    function updateOverviewBanner(data) {
        if (state.activeTab !== 'overview') {
            clearAccessState();
            return;
        }

        if (isOverviewIssuePayloadPending(data)) {
            clearAccessState();
            return;
        }

        const anomaly = data?.anomaly_summary || {};
        const issueBreakdown = getOverviewIssueBreakdown(data);
        const refundIssueCount = issueBreakdown.refund_issues;
        const anomalyCount = issueBreakdown.total;

        if (anomalyCount > 0) {
            const issueParts = [
                issueBreakdown.review_orders > 0 ? `待审核 ${formatNumber(issueBreakdown.review_orders)}` : '',
                issueBreakdown.failed_orders > 0 ? `失败订单 ${formatNumber(issueBreakdown.failed_orders)}` : '',
                issueBreakdown.callback_issues > 0 ? `回调/意图 ${formatNumber(issueBreakdown.callback_issues)}` : '',
                issueBreakdown.query_failures > 0 ? `查码失败 ${formatNumber(issueBreakdown.query_failures)}` : '',
                (refundIssueCount > 0 || issueBreakdown.callback_issues > 0) ? `退款售后 ${formatNumber(refundIssueCount)}` : ''
            ].filter(Boolean);
            const issueBreakdownText = issueParts.length ? `（${issueParts.join('，')}）` : '';
            renderAccessState(
                `当前有 ${formatNumber(anomalyCount)} 项未归档专题异常需要关注${issueBreakdownText}，请优先查看金额异常、待审核、重复回调、查码失败、支付意图回填与退款售后。`,
                Number(anomaly.refund_compensation_failures || 0) > 0 ? 'error' : 'warning',
                { preserveBody: true }
            );
            return;
        }

        clearAccessState();
    }

    function syncTabIndicator() {
        const nav = document.getElementById('paymentsTabsNav');
        if (!nav) return;
        const activeButton = nav.querySelector('.admin-tab.active');
        if (!activeButton) return;
        window.updateAdminTabIndicator?.(activeButton);
    }

    function switchTab(tabId, options = {}) {
        const shouldReload = options.reload !== false;
        state.activeTab = String(tabId || 'overview');
        const hasCachedTabData = hasCachedDataForTab(state.activeTab);
        const nav = document.getElementById('paymentsTabsNav');
        if (nav) {
            nav.querySelectorAll('.admin-tab').forEach((button) => {
                button.classList.toggle('active', button.dataset.tab === state.activeTab);
            });
        }

        document.querySelectorAll('.payments-tab-content').forEach((section) => {
            section.classList.toggle('active', section.id === `payments-tab-${state.activeTab}`);
        });

        syncTabIndicator();
        window.dispatchEvent(new Event('resize'));

        if (state.initialized && state.summary && hasCachedTabData) {
            updateToolbarHighlights(state.summary);
            rerenderCurrentView();
            updateOverviewBanner(state.summary);
            renderAnalyticsIssueSummary(state.summary, state.workbenchContext);
        }

        if (shouldReload && state.initialized && !state.loading && !hasCachedTabData) {
            reload();
            return;
        }

        if (shouldReload && state.initialized && state.loading && !hasCachedTabData && !hasRenderedContentForTab(state.activeTab)) {
            renderLoadingSkeletonForTab(state.activeTab);
        }

        if (state.initialized) {
            scheduleTabPrefetch(state.activeTab);
        }
    }

    function renderAccessState(message, tone = 'warning', options = {}) {
        const stateEl = document.getElementById('paymentsAccessState');
        const bodyEl = document.getElementById('paymentsDashboardBody');
        if (!stateEl || !bodyEl) return;
        const preserveBody = options.preserveBody === true;
        const normalizedMessage = String(message || '').trim();

        if (!normalizedMessage) {
            stateEl.hidden = true;
            bodyEl.hidden = false;
            return;
        }

        stateEl.className = `payments-access-state ${tone}`;
        stateEl.innerHTML = `
            <i class="fas ${tone === 'error' ? 'fa-ban' : 'fa-shield-alt'}"></i>
            <span>${escapeHtml(normalizedMessage)}</span>
        `;
        stateEl.hidden = false;
        bodyEl.hidden = preserveBody ? false : true;
    }

    function clearAccessState() {
        const stateEl = document.getElementById('paymentsAccessState');
        const bodyEl = document.getElementById('paymentsDashboardBody');
        if (!stateEl || !bodyEl) return;
        stateEl.hidden = true;
        bodyEl.hidden = false;
    }

    function setLoading(loading) {
        state.loading = loading;
        const refreshBtn = document.getElementById('paymentsRefreshBtn');
        if (refreshBtn) {
            refreshBtn.disabled = loading;
            refreshBtn.innerHTML = loading
                ? '<i class="fas fa-spinner fa-spin"></i>'
                : '<i class="fas fa-sync-alt"></i>';
            refreshBtn.title = loading ? '正在刷新支付数据' : '刷新支付数据';
        }
        if (loading) {
            setToolbarMeta('正在刷新…', 'info');
        } else if (state.lastSyncedAt) {
            setToolbarMeta(`上次刷新 ${formatToolbarTime(state.lastSyncedAt)}`, 'ready');
        } else {
            setToolbarMeta('等待载入支付数据', 'muted');
        }
    }

    function setCleanupLoading(loading) {
        state.cleanupLoading = loading;
        const cleanupBtn = document.getElementById('paymentsCleanupBtn');
        const previewBtn = document.getElementById('paymentsCleanupPreviewBtn');
        if (cleanupBtn) {
            cleanupBtn.disabled = loading;
            cleanupBtn.innerHTML = loading
                ? '<i class="fas fa-spinner fa-spin"></i> 清理中'
                : '<i class="fas fa-broom"></i> 清理测试数据';
        }
        if (previewBtn) {
            previewBtn.disabled = loading;
        }
    }

    function getCleanupTotalCount(counts = {}) {
        return Number(counts.payment_orders || 0)
            + Number(counts.payment_events || 0)
            + Number(counts.afdian_orders || 0)
            + Number(counts.auth_users || 0);
    }

    function setCleanupCardVisible(visible) {
        const cleanupCard = document.getElementById('paymentsCleanupCard');
        if (!cleanupCard) return;
        cleanupCard.hidden = !visible;
    }

    function buildPaymentsSkeletonBlock(variant = 'line', widthClass = 'admin-skeleton-w-full', extraClass = '') {
        const classes = ['admin-skeleton-block'];
        if (variant) {
            classes.push(`admin-skeleton-block--${variant}`);
        }
        if (widthClass) {
            classes.push(widthClass);
        }
        if (extraClass) {
            classes.push(extraClass);
        }
        return `<span class="${classes.join(' ')}"></span>`;
    }

    function buildPaymentsSkeletonPills(count = 3) {
        const widths = ['admin-skeleton-w-chip-xs', 'admin-skeleton-w-chip-sm', 'admin-skeleton-w-chip-md'];
        return Array.from({ length: count }, (_, index) => buildPaymentsSkeletonBlock('pill', widths[index % widths.length])).join('');
    }

    function buildPaymentsKpiSkeletonCards(count = 6) {
        const valueWidths = ['admin-skeleton-w-50', 'admin-skeleton-w-40', 'admin-skeleton-w-60', 'admin-skeleton-w-30'];
        const labelWidths = ['admin-skeleton-w-30', 'admin-skeleton-w-40', 'admin-skeleton-w-20', 'admin-skeleton-w-30'];

        return Array.from({ length: count }, (_, index) => `
            <div class="kpi-card payments-kpi-card-visual payments-kpi-card-skeleton" aria-hidden="true">
                <div class="payments-kpi-main">
                    <span class="admin-skeleton-block payments-skeleton-icon"></span>
                    <div class="kpi-content payments-skeleton-stack">
                        ${buildPaymentsSkeletonBlock('title', valueWidths[index % valueWidths.length])}
                        ${buildPaymentsSkeletonBlock('line', labelWidths[index % labelWidths.length])}
                    </div>
                </div>
            </div>
        `).join('');
    }

    function buildPaymentsProviderRowSkeleton(index = 0, options = {}) {
        const isOverview = options.variant === 'overview';
        const isExpanded = isOverview && index % 2 === 1;
        const titleWidth = isExpanded ? 'admin-skeleton-w-40' : 'admin-skeleton-w-30';
        const metaWidth = isOverview
            ? (isExpanded ? 'admin-skeleton-w-60' : 'admin-skeleton-w-70')
            : 'admin-skeleton-w-80';
        const extraPillCount = isOverview ? (isExpanded ? 4 : 3) : 4;
        const badgeCount = isOverview ? (isExpanded ? 4 : 2) : 3;

        return `
            <div class="payments-provider-row payments-provider-row--skeleton payments-skeleton-card" aria-hidden="true">
                <div class="payments-provider-copy payments-skeleton-stack">
                    <div class="payments-provider-name payments-skeleton-inline">
                        <span class="admin-skeleton-block payments-skeleton-inline-icon"></span>
                        ${buildPaymentsSkeletonBlock('title', titleWidth)}
                    </div>
                    ${buildPaymentsSkeletonBlock('line', metaWidth)}
                    ${isExpanded ? buildPaymentsSkeletonBlock('line', 'admin-skeleton-w-50') : ''}
                    <div class="payments-provider-extra payments-skeleton-inline">
                        ${buildPaymentsSkeletonPills(extraPillCount)}
                    </div>
                </div>
                <div class="payments-provider-badges payments-skeleton-inline">
                    ${buildPaymentsSkeletonPills(badgeCount)}
                </div>
            </div>
        `;
    }

    function buildPaymentsBreakdownSkeleton() {
        return `
            <div class="payments-breakdown-card payments-skeleton-card" aria-hidden="true">
                <div class="payments-row-head">
                    <div class="payments-row-title-wrap payments-skeleton-stack">
                        ${buildPaymentsSkeletonBlock('title', 'admin-skeleton-w-40')}
                        ${buildPaymentsSkeletonBlock('line', 'admin-skeleton-w-80')}
                    </div>
                    <div class="payments-row-metric-wrap payments-skeleton-stack payments-skeleton-stack--align-end">
                        ${buildPaymentsSkeletonBlock('title', 'admin-skeleton-w-30')}
                    </div>
                </div>
                <div class="payments-breakdown-meta payments-skeleton-inline">
                    ${buildPaymentsSkeletonPills(3)}
                </div>
            </div>
        `;
    }

    function buildPaymentsBusinessBoardSkeleton() {
        return `
            <div class="payments-business-board payments-business-board--skeleton" aria-hidden="true">
                <div class="payments-business-trend-panel payments-skeleton-card">
                    <div class="payments-business-trend-head">
                        <div class="payments-skeleton-stack">
                            ${buildPaymentsSkeletonBlock('title', 'admin-skeleton-w-30')}
                            ${buildPaymentsSkeletonBlock('line', 'admin-skeleton-w-60')}
                        </div>
                        <div class="payments-skeleton-stack payments-skeleton-stack--align-end">
                            ${buildPaymentsSkeletonBlock('pill', 'admin-skeleton-w-chip-md')}
                            ${buildPaymentsSkeletonBlock('line', 'admin-skeleton-w-30')}
                        </div>
                    </div>
                    <div class="payments-business-legend">
                        ${buildPaymentsSkeletonPills(5)}
                    </div>
                    <div class="payments-business-trend-body">
                        <div class="payments-business-trend-plot-shell">
                            <div class="payments-business-trend-plot-frame">
                                <div class="payments-business-trend-skeleton-grid">
                                    ${Array.from({ length: 5 }, () => '<span></span>').join('')}
                                </div>
                            </div>
                        </div>
                        <div class="payments-business-trend-inspector payments-skeleton-stack">
                            ${buildPaymentsSkeletonBlock('title', 'admin-skeleton-w-50')}
                            ${Array.from({ length: 4 }, () => buildPaymentsSkeletonBlock('line', 'admin-skeleton-w-full')).join('')}
                        </div>
                    </div>
                </div>
                <div class="payments-business-table-panel payments-skeleton-card">
                    <div class="payments-business-table-head">
                        ${buildPaymentsSkeletonBlock('title', 'admin-skeleton-w-20')}
                        ${buildPaymentsSkeletonBlock('line', 'admin-skeleton-w-50')}
                    </div>
                    <div class="payments-business-table-skeleton-rows">
                        ${Array.from({ length: 4 }, () => buildPaymentsSkeletonBlock('line', 'admin-skeleton-w-full')).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    function buildPaymentsPointsRowSkeleton() {
        return `
            <div class="payments-points-row payments-skeleton-card" aria-hidden="true">
                <div class="payments-row-head">
                    <div class="payments-row-title-wrap payments-skeleton-stack">
                        ${buildPaymentsSkeletonBlock('title', 'admin-skeleton-w-30')}
                        ${buildPaymentsSkeletonBlock('line', 'admin-skeleton-w-70')}
                    </div>
                    <div class="payments-row-metric-wrap payments-skeleton-stack payments-skeleton-stack--align-end">
                        ${buildPaymentsSkeletonBlock('title', 'admin-skeleton-w-20')}
                    </div>
                </div>
                <div class="payments-points-values payments-skeleton-inline">
                    ${buildPaymentsSkeletonPills(3)}
                </div>
            </div>
        `;
    }

    function buildPaymentsAnomalySkeleton() {
        return `
            <div class="payments-anomaly-item payments-anomaly-item--skeleton" aria-hidden="true">
                <div class="payments-anomaly-top">
                    <div class="payments-anomaly-copy payments-skeleton-stack">
                        ${buildPaymentsSkeletonBlock('title', 'admin-skeleton-w-50')}
                        ${buildPaymentsSkeletonBlock('line', 'admin-skeleton-w-full')}
                        ${buildPaymentsSkeletonBlock('line', 'admin-skeleton-w-70')}
                    </div>
                    ${buildPaymentsSkeletonBlock('pill', 'admin-skeleton-w-chip-sm')}
                </div>
                <div class="payments-anomaly-suggestion payments-anomaly-suggestion--skeleton">
                    <span class="admin-skeleton-block payments-skeleton-inline-icon payments-skeleton-inline-icon--tiny"></span>
                    <div class="payments-skeleton-stack">
                        ${buildPaymentsSkeletonBlock('line', 'admin-skeleton-w-full')}
                        ${buildPaymentsSkeletonBlock('line', 'admin-skeleton-w-80')}
                    </div>
                </div>
                <div class="payments-anomaly-meta payments-anomaly-meta--skeleton">
                    <span>${buildPaymentsSkeletonBlock('tiny', 'admin-skeleton-w-20')}${buildPaymentsSkeletonBlock('line', 'admin-skeleton-w-50')}</span>
                    <span>${buildPaymentsSkeletonBlock('tiny', 'admin-skeleton-w-20')}${buildPaymentsSkeletonBlock('line', 'admin-skeleton-w-40')}</span>
                    <span>${buildPaymentsSkeletonBlock('tiny', 'admin-skeleton-w-20')}${buildPaymentsSkeletonBlock('line', 'admin-skeleton-w-30')}</span>
                    <span>${buildPaymentsSkeletonBlock('tiny', 'admin-skeleton-w-20')}${buildPaymentsSkeletonBlock('line', 'admin-skeleton-w-60')}</span>
                </div>
            </div>
        `;
    }

    function buildPaymentsRefundAlertItemSkeleton() {
        return `
            <div class="payments-refund-alert-item payments-refund-alert-item--skeleton" aria-hidden="true">
                <div class="payments-refund-alert-item-top payments-refund-alert-item-top--skeleton">
                    <div class="payments-refund-alert-item-copy payments-refund-alert-item-copy--skeleton">
                        ${buildPaymentsSkeletonBlock('title', 'admin-skeleton-w-50')}
                        ${buildPaymentsSkeletonBlock('line', 'admin-skeleton-w-full')}
                    </div>
                    ${buildPaymentsSkeletonBlock('pill', 'admin-skeleton-w-chip-sm')}
                </div>
                <div class="payments-refund-alert-item-meta payments-refund-alert-item-meta--skeleton">
                    <span><small>${buildPaymentsSkeletonBlock('tiny', 'admin-skeleton-w-20')}</small><strong>${buildPaymentsSkeletonBlock('line', 'admin-skeleton-w-40')}</strong></span>
                    <span><small>${buildPaymentsSkeletonBlock('tiny', 'admin-skeleton-w-20')}</small><strong>${buildPaymentsSkeletonBlock('line', 'admin-skeleton-w-30')}</strong></span>
                    <span><small>${buildPaymentsSkeletonBlock('tiny', 'admin-skeleton-w-20')}</small><strong>${buildPaymentsSkeletonBlock('line', 'admin-skeleton-w-30')}</strong></span>
                </div>
                <div class="payments-anomaly-ops payments-anomaly-ops--skeleton">
                    ${buildPaymentsSkeletonBlock('pill', 'admin-skeleton-w-chip-sm')}
                    ${buildPaymentsSkeletonBlock('pill', 'admin-skeleton-w-chip-md')}
                </div>
                <div class="payments-refund-alert-hint payments-refund-alert-hint--skeleton">
                    ${buildPaymentsSkeletonBlock('line', 'admin-skeleton-w-full')}
                    ${buildPaymentsSkeletonBlock('line', 'admin-skeleton-w-80')}
                </div>
            </div>
        `;
    }

    function buildPaymentsRefundSkeletonTopic() {
        return `
            <article class="payments-refund-topic-card payments-skeleton-card" aria-hidden="true">
                <div class="payments-refund-topic-head">
                    <div class="payments-refund-topic-copy payments-refund-topic-copy--skeleton">
                        <div class="payments-refund-topic-title payments-refund-topic-title--skeleton">
                            <span class="admin-skeleton-block payments-skeleton-inline-icon"></span>
                            ${buildPaymentsSkeletonBlock('title', 'admin-skeleton-w-40')}
                        </div>
                        <div class="payments-refund-topic-description payments-refund-topic-description--skeleton">
                            ${buildPaymentsSkeletonBlock('line', 'admin-skeleton-w-full')}
                            ${buildPaymentsSkeletonBlock('line', 'admin-skeleton-w-70')}
                        </div>
                    </div>
                    <div class="payments-provider-badges payments-skeleton-inline">
                        ${buildPaymentsSkeletonPills(2)}
                    </div>
                </div>
                <div class="payments-refund-alert-stream">
                    ${Array.from({ length: 2 }, () => buildPaymentsRefundAlertItemSkeleton()).join('')}
                </div>
            </article>
        `;
    }

    function buildPaymentsTrendLegendSkeleton() {
        const widths = ['admin-skeleton-w-30', 'admin-skeleton-w-40', 'admin-skeleton-w-30'];

        return `
            <div class="payments-trend-legend-skeleton" aria-hidden="true">
                ${widths.map((widthClass) => `
                    <span class="payments-trend-legend-skeleton-item">
                        <span class="admin-skeleton-block payments-skeleton-inline-icon payments-skeleton-inline-icon--tiny"></span>
                        ${buildPaymentsSkeletonBlock('line', widthClass)}
                    </span>
                `).join('')}
            </div>
        `;
    }

    function buildPaymentsTrendSkeleton() {
        const markerClasses = [
            'payments-trend-skeleton-bar--sm',
            'payments-trend-skeleton-bar--md',
            'payments-trend-skeleton-bar--lg',
            'payments-trend-skeleton-bar--md'
        ];

        return `
            <div class="payments-trend-skeleton" aria-hidden="true">
                ${Array.from({ length: 24 }, (_, index) => `
                    <div class="payments-trend-skeleton-column">
                        <span class="admin-skeleton-block payments-trend-skeleton-bar ${markerClasses[index % markerClasses.length]}"></span>
                        ${index % 4 === 0 || index === 23
                            ? buildPaymentsSkeletonBlock('line', index === 23 ? 'admin-skeleton-w-30' : 'admin-skeleton-w-20', 'payments-trend-skeleton-label')
                            : '<span class="payments-trend-skeleton-label payments-trend-skeleton-label--empty" aria-hidden="true"></span>'}
                    </div>
                `).join('')}
            </div>
        `;
    }

    function buildPaymentsOrdersSkeleton(rowCount = 4) {
        const actionLayouts = [
            ['admin-skeleton-w-chip-sm'],
            ['admin-skeleton-w-chip-xs', 'admin-skeleton-w-chip-sm'],
            ['admin-skeleton-w-chip-md'],
            ['admin-skeleton-w-chip-sm', 'admin-skeleton-w-chip-xs']
        ];

        return `
            <div class="payments-table-wrap">
                <table class="payments-table payments-table-skeleton payments-orders-grid-table" aria-hidden="true">
                    <thead>
                        <tr>
                            <th>用户邮箱</th>
                            <th>订单号</th>
                            <th>套餐</th>
                            <th>金额</th>
                            <th>积分</th>
                            <th>状态</th>
                            <th>意图匹配</th>
                            <th>站点</th>
                            <th>创建时间</th>
                            <th>认领时间</th>
                            <th>操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${Array.from({ length: rowCount }, (_, index) => `
                            <tr class="payments-table-skeleton-row">
                                <td>${buildPaymentsSkeletonBlock('line', index % 2 === 0 ? 'admin-skeleton-w-40' : 'admin-skeleton-w-50')}</td>
                                <td>
                                    <div class="payments-skeleton-stack">
                                        ${buildPaymentsSkeletonBlock('title', index % 2 === 0 ? 'admin-skeleton-w-40' : 'admin-skeleton-w-50')}
                                        ${buildPaymentsSkeletonBlock('line', 'admin-skeleton-w-30')}
                                    </div>
                                </td>
                                <td>${buildPaymentsSkeletonBlock('line', 'admin-skeleton-w-40')}</td>
                                <td>${buildPaymentsSkeletonBlock('line', 'admin-skeleton-w-20')}</td>
                                <td>${buildPaymentsSkeletonBlock('line', 'admin-skeleton-w-20')}</td>
                                <td>${buildPaymentsSkeletonBlock('pill', 'admin-skeleton-w-chip-sm')}</td>
                                <td>${buildPaymentsSkeletonBlock('pill', 'admin-skeleton-w-chip-md')}</td>
                                <td>${buildPaymentsSkeletonBlock('line', 'admin-skeleton-w-20')}</td>
                                <td>${buildPaymentsSkeletonBlock('line', 'admin-skeleton-w-30')}</td>
                                <td>${buildPaymentsSkeletonBlock('line', 'admin-skeleton-w-30')}</td>
                                <td>
                                    <div class="payments-anomaly-actions payments-orders-skeleton-actions">
                                        ${actionLayouts[index % actionLayouts.length].map((widthClass) => buildPaymentsSkeletonBlock('pill', widthClass, 'payments-orders-skeleton-action')).join('')}
                                    </div>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    function buildPaymentsCleanupSkeleton() {
        return `
            <div class="payments-cleanup-grid" aria-hidden="true">
                ${Array.from({ length: 4 }, () => `
                    <div class="payments-cleanup-stat payments-cleanup-stat--skeleton">
                        ${buildPaymentsSkeletonBlock('line', 'admin-skeleton-w-30')}
                        ${buildPaymentsSkeletonBlock('title', 'admin-skeleton-w-20')}
                    </div>
                `).join('')}
            </div>
            <div class="payments-cleanup-note payments-cleanup-note--skeleton">
                ${buildPaymentsSkeletonBlock('line', 'admin-skeleton-w-full')}
                ${buildPaymentsSkeletonBlock('line', 'admin-skeleton-w-80')}
            </div>
            <div class="payments-cleanup-samples" aria-hidden="true">
                ${Array.from({ length: 2 }, () => `
                    <div class="payments-skeleton-card payments-skeleton-stack">
                        ${buildPaymentsSkeletonBlock('title', 'admin-skeleton-w-30')}
                        ${buildPaymentsSkeletonBlock('line', 'admin-skeleton-w-full')}
                        ${buildPaymentsSkeletonBlock('line', 'admin-skeleton-w-70')}
                        ${buildPaymentsSkeletonBlock('line', 'admin-skeleton-w-60')}
                    </div>
                `).join('')}
            </div>
        `;
    }

    function renderPaymentsToolbarHighlightsSkeleton() {
        const target = document.getElementById('paymentsToolbarHighlights');
        if (!target) return;

        target.innerHTML = Array.from({ length: 4 }, () => `
            <div class="payments-highlight-pill payments-highlight-pill--skeleton" aria-hidden="true">
                ${buildPaymentsSkeletonBlock('pill', 'admin-skeleton-w-chip-lg')}
            </div>
        `).join('');
    }

    function renderOverviewSecondarySkeletons() {
        const refundPanel = document.getElementById('paymentsRefundAlertsPanel');
        const refundMeta = document.getElementById('paymentsRefundAlertsMeta');
        const refundTarget = document.getElementById('paymentsRefundAlerts');
        const providerStats = document.getElementById('paymentsProviderStats');
        const trendChart = document.getElementById('paymentsTrendChart');
        const trendLegend = document.getElementById('paymentsTrendLegend');

        if (refundPanel && refundMeta && refundTarget) {
            refundPanel.hidden = true;
            refundMeta.textContent = '';
            refundTarget.innerHTML = '';
        }
        if (providerStats) {
            providerStats.innerHTML = Array.from({ length: 2 }, (_, index) => buildPaymentsProviderRowSkeleton(index, { variant: 'overview' })).join('');
        }
        if (trendChart) {
            trendChart.innerHTML = buildPaymentsTrendSkeleton();
        }
        if (trendLegend) {
            trendLegend.innerHTML = buildPaymentsTrendLegendSkeleton();
        }
    }

    function isCurrentOverviewDeferredRequest(requestToken, cacheKey = '') {
        if (requestToken !== state.requestToken) {
            return false;
        }
        if (cacheKey && cacheKey !== getCurrentCacheKey()) {
            return false;
        }
        return true;
    }

    function applyOverviewSecondaryPayload(payload, requestToken, options = {}) {
        if (!isCurrentOverviewDeferredRequest(requestToken, options.cacheKey)) {
            return false;
        }

        mergeSummaryPayload(payload, { sourceTab: 'overview' });
        state.overviewSecondaryLoaded = true;
        if (state.activeTab !== 'overview') {
            return true;
        }
        syncOverviewStage();

        const data = state.summary;
        updateToolbarHighlights(data);
        renderOverviewCards(data);
        renderRefundAlerts(data);
        renderProviderStats(data);
        renderTrend(data);
        updateOverviewBanner(data);
        renderAnalyticsIssueSummary(data, state.workbenchContext);
        updateOverviewLoadingMeta();
        return true;
    }

    function applyOverviewOpsPayload(payload, requestToken, options = {}) {
        if (!isCurrentOverviewDeferredRequest(requestToken, options.cacheKey)) {
            return false;
        }

        mergeSummaryPayload(payload, { sourceTab: 'overview' });
        state.overviewOpsLoaded = true;
        if (state.activeTab !== 'overview') {
            return true;
        }
        syncOverviewStage();

        renderAnalyticsIssueSummary(state.summary, state.workbenchContext);
        updateOverviewLoadingMeta();
        return true;
    }

    async function loadOverviewDeferredScopes(requestToken, cacheKey = getCurrentCacheKey()) {
        const secondaryQuery = buildSummaryQuery('overview', { scope: 'secondary' });
        const opsQuery = buildSummaryQuery('overview', { scope: 'ops' });
        const results = await Promise.allSettled([
            fetchAdminJson(`/api/admin/payments/summary?${secondaryQuery.toString()}`)
                .then((payload) => applyOverviewSecondaryPayload(payload, requestToken, { cacheKey })),
            fetchAdminJson(`/api/admin/payments/summary?${opsQuery.toString()}`)
                .then((payload) => applyOverviewOpsPayload(payload, requestToken, { cacheKey }))
        ]);

        if (!isCurrentOverviewDeferredRequest(requestToken, cacheKey)) {
            return false;
        }

        const failedResult = results.find((result) => result.status === 'rejected');
        if (failedResult?.reason) {
            console.warn('[AdminPayments] overview deferred scope failed:', failedResult.reason);
            if (state.activeTab === 'overview') {
                renderAccessState(
                    getFriendlyErrorMessage(failedResult.reason, '支付总览首屏已加载，但部分趋势或告警刷新失败，请稍后重试。'),
                    'warning',
                    { preserveBody: true }
                );
                setToolbarMeta('首屏已加载，部分详情刷新失败', 'warning');
            }
            return false;
        }

        if (state.overviewSecondaryLoaded && state.overviewOpsLoaded) {
            state.viewCache.overview = cacheKey;
            if (state.activeTab === 'overview') {
                syncOverviewStage();
                updateToolbarHighlights(state.summary);
                renderOverviewCards(state.summary);
                updateOverviewBanner(state.summary);
                renderAnalyticsIssueSummary(state.summary, state.workbenchContext);
            }
            updateLastSynced(new Date());
            scheduleTabPrefetch(state.activeTab);
            return true;
        }

        return false;
    }

    function hasRenderedContentForTab(tabId = state.activeTab) {
        const normalizedTab = String(tabId || state.activeTab || 'overview').trim().toLowerCase() || 'overview';

        if (normalizedTab === 'finance') {
            return Boolean(
                document.getElementById('paymentsSitewideGrid')?.childElementCount
                || document.getElementById('paymentsBusinessBreakdown')?.childElementCount
                || document.getElementById('paymentsPointsBreakdown')?.childElementCount
            );
        }

        if (normalizedTab === 'ops') {
            return Boolean(
                document.getElementById('paymentsOpsAlertQueue')?.childElementCount
                || document.getElementById('paymentsExceptionTopics')?.childElementCount
                || document.getElementById('paymentsAnomalyList')?.childElementCount
                || document.getElementById('paymentsCheckoutSessionsList')?.childElementCount
                || document.getElementById('paymentsOrdersTable')?.childElementCount
                || document.getElementById('paymentsCleanupPreview')?.childElementCount
            );
        }

        return Boolean(
            document.getElementById('paymentsOverviewGrid')?.childElementCount
            || document.getElementById('paymentsProviderStats')?.childElementCount
            || document.getElementById('paymentsTrendChart')?.childElementCount
            || document.getElementById('paymentsRefundAlerts')?.childElementCount
        );
    }

    function renderLoadingSkeletonForTab(tabId = state.activeTab) {
        const normalizedTab = String(tabId || state.activeTab || 'overview').trim().toLowerCase() || 'overview';
        renderPaymentsToolbarHighlightsSkeleton();

        if (normalizedTab === 'finance') {
            const sitewideGrid = document.getElementById('paymentsSitewideGrid');
            const businessBreakdown = document.getElementById('paymentsBusinessBreakdown');
            const pointsBreakdown = document.getElementById('paymentsPointsBreakdown');

            if (sitewideGrid) {
                sitewideGrid.innerHTML = buildPaymentsKpiSkeletonCards(7);
            }
            if (businessBreakdown) {
                businessBreakdown.innerHTML = buildPaymentsBusinessBoardSkeleton();
            }
            if (pointsBreakdown) {
                pointsBreakdown.innerHTML = buildPaymentsBusinessBoardSkeleton();
            }
            return;
        }

        if (normalizedTab === 'ops') {
            const queueTarget = document.getElementById('paymentsOpsAlertQueue');
            const queueMeta = document.getElementById('paymentsOpsAlertQueueMeta');
            const topicsTarget = document.getElementById('paymentsExceptionTopics');
            const topicListTarget = document.getElementById('paymentsExceptionTopicList');
            const anomalyTarget = document.getElementById('paymentsAnomalyList');
            const sessionsTarget = document.getElementById('paymentsCheckoutSessionsList');
            const ordersTarget = document.getElementById('paymentsOrdersTable');
            const cleanupTarget = document.getElementById('paymentsCleanupPreview');

            if (queueMeta) {
                queueMeta.textContent = '正在加载站外告警队列...';
            }
            if (queueTarget) {
                queueTarget.innerHTML = `<div class="payments-anomaly-items">${Array.from({ length: 3 }, () => buildPaymentsAnomalySkeleton()).join('')}</div>`;
            }
            if (topicsTarget) {
                topicsTarget.innerHTML = Array.from({ length: 3 }, () => buildPaymentsProviderRowSkeleton()).join('');
            }
            if (topicListTarget) {
                topicListTarget.innerHTML = `<div class="payments-anomaly-items">${Array.from({ length: 2 }, () => buildPaymentsAnomalySkeleton()).join('')}</div>`;
            }
            if (anomalyTarget) {
                anomalyTarget.innerHTML = `<div class="payments-anomaly-items">${Array.from({ length: 3 }, () => buildPaymentsAnomalySkeleton()).join('')}</div>`;
            }
            if (sessionsTarget) {
                sessionsTarget.innerHTML = Array.from({ length: 4 }, () => buildPaymentsProviderRowSkeleton()).join('');
            }
            if (ordersTarget) {
                ordersTarget.innerHTML = buildPaymentsOrdersSkeleton();
            }
            if (cleanupTarget) {
                const showCleanupSkeleton = getCleanupTotalCount(state.cleanupPreview?.counts || {}) > 0;
                setCleanupCardVisible(showCleanupSkeleton);
                cleanupTarget.innerHTML = showCleanupSkeleton ? buildPaymentsCleanupSkeleton() : '';
            }
            return;
        }

        const overviewGrid = document.getElementById('paymentsOverviewGrid');

        if (overviewGrid) {
            overviewGrid.innerHTML = buildPaymentsKpiSkeletonCards(10);
        }
        renderOverviewSecondarySkeletons();
    }

    function renderMetricCards(target, cards) {
        if (!target) return;

        target.innerHTML = cards.map((card) => `
            <div class="kpi-card payments-kpi-card-visual ${card.tone ? `is-${card.tone}` : ''}">
                <div class="payments-kpi-main">
                    <div class="kpi-icon payments-kpi-icon">
                        <i class="${escapeHtml(card.icon || 'fas fa-chart-line')}"></i>
                    </div>
                    <div class="kpi-content">
                        <div class="payments-kpi-value">${escapeHtml(card.value)}</div>
                        <div class="payments-kpi-label-row">
                            <div class="payments-kpi-label">${escapeHtml(card.label)}</div>
                            ${renderInfoChip(card.help)}
                        </div>
                    </div>
                </div>
            </div>
        `).join('');
    }

    function renderOverviewCards(data) {
        const overview = data?.overview || {};
        const anomaly = data?.anomaly_summary || {};
        const sessionSummary = data?.session_summary || {};
        const querySummary = data?.query_summary || {};
        const target = document.getElementById('paymentsOverviewGrid');
        if (!target) return;
        const isCoreOverview = isOverviewCorePayload(data);
        const refundIssueCount = getRefundIssueCount(data);
        const refundBreakdown = getRefundIssueBreakdown(data);
        const callbackBreakdown = getCallbackIssueBreakdown(data);
        const callbackIssueCount = Number(callbackBreakdown.duplicate_webhook_orders || 0)
            + Number(callbackBreakdown.session_anomalies || 0);

        const cards = [
            {
                icon: 'fas fa-file-invoice-dollar',
                label: '总订单',
                value: formatNumber(overview.total_orders),
                help: `近 ${state.days} 天支付订单总数`
            },
            {
                icon: 'fas fa-circle-check',
                label: '支付成功率',
                value: formatPercent(overview.paid_rate),
                help: `${formatNumber(overview.paid_orders)} 笔已支付/已兑换`
            },
            {
                icon: 'fas fa-link',
                label: '意图匹配率',
                value: formatPercent(sessionSummary.order_match_rate || sessionSummary.match_rate),
                help: Number(sessionSummary.total_sessions || 0) > 0
                    ? `${formatNumber(sessionSummary.matched_sessions)} / ${formatNumber(sessionSummary.total_sessions)} 会话已回填 · 自动 ${formatNumber(sessionSummary.webhook_linked_sessions)} · 兜底 ${formatNumber(sessionSummary.fallback_linked_sessions)}`
                    : '当前时间范围内暂无可统计的支付意图'
            },
            {
                icon: 'fas fa-wallet',
                label: '支付金额',
                value: formatCurrency(overview.total_amount),
                help: `${formatNumber(overview.total_points)} 已入账`,
                tone: 'money'
            },
            {
                icon: 'fas fa-hourglass-half',
                label: '待审核',
                value: formatNumber(anomaly.review_orders),
                help: '套餐匹配、金额或签名需人工确认',
                tone: 'warning'
            },
            {
                icon: 'fas fa-triangle-exclamation',
                label: '失败订单',
                value: formatNumber(anomaly.failed_orders),
                help: '签名失败或金额校验失败',
                tone: 'critical'
            },
            {
                icon: 'fas fa-unlink',
                label: '未认领订单',
                value: formatNumber(anomaly.unclaimed_paid_orders),
                help: '已支付但尚未输入订单号',
                tone: 'info'
            },
            {
                icon: 'fas fa-wave-square',
                label: isCoreOverview ? '回调专题补充中' : '回调专题',
                value: isCoreOverview ? '补充中' : formatNumber(callbackIssueCount),
                help: isCoreOverview
                    ? '正在补充重复回调、支付意图回填和趋势统计。'
                    : `未归档专题中的回调/意图部分：重复回调 ${formatNumber(callbackBreakdown.duplicate_webhook_orders)} · 支付意图异常 ${formatNumber(callbackBreakdown.session_anomalies)}，不含退款失败与扣回失败。`,
                tone: isCoreOverview ? 'info' : 'warning'
            },
            {
                icon: 'fas fa-rotate-left',
                label: isCoreOverview ? '退款异常补充中' : '退款异常',
                value: isCoreOverview ? '补充中' : formatNumber(refundIssueCount),
                help: isCoreOverview
                    ? '正在补充退款失败、积分扣回失败和积分回滚失败统计。'
                    : `退款失败 ${formatNumber(refundBreakdown.refund_failures)} · 扣回失败 ${formatNumber(refundBreakdown.refund_reclaim_failures)} · 回滚失败 ${formatNumber(refundBreakdown.refund_compensation_failures)}`,
                tone: isCoreOverview
                    ? 'info'
                    : (Number(refundBreakdown.refund_compensation_failures || 0) > 0 || Number(refundBreakdown.refund_reclaim_failures || 0) > 0
                    ? 'critical'
                    : (refundIssueCount > 0 ? 'warning' : 'info'))
            },
            {
                icon: 'fas fa-magnifying-glass-chart',
                label: '查码成功率',
                value: Number(querySummary.total_attempts || 0) > 0 ? formatPercent(querySummary.success_rate) : '—',
                help: Number(querySummary.total_attempts || 0) > 0
                    ? `${formatNumber(querySummary.failed_attempts)} 次失败 · 总查询 ${formatNumber(querySummary.total_attempts)} 次`
                    : '当前时间范围内暂无查码请求',
                tone: Number(querySummary.failed_attempts || 0) > 0 ? 'warning' : 'info'
            }
        ];

        renderMetricCards(target, cards);
    }

    function renderRefundAlerts(data) {
        const panel = document.getElementById('paymentsRefundAlertsPanel');
        const target = document.getElementById('paymentsRefundAlerts');
        const meta = document.getElementById('paymentsRefundAlertsMeta');
        if (!panel || !target || !meta) return;

        const topics = (Array.isArray(data?.refund_alert_topics) ? data.refund_alert_topics : [])
            .filter((topic) => REFUND_TOPIC_KEY_SET.has(String(topic?.key || '').trim().toLowerCase()))
            .sort((left, right) => REFUND_TOPIC_ORDER.indexOf(String(left?.key || '').trim().toLowerCase()) - REFUND_TOPIC_ORDER.indexOf(String(right?.key || '').trim().toLowerCase()));
        const items = getActiveRefundAlertItems(data);
        const totalCount = topics.reduce((sum, topic) => sum + Number(topic?.count || 0), 0);
        const criticalCount = topics.reduce((sum, topic) => sum + (String(topic?.severity || '').trim().toLowerCase() === 'critical' ? Number(topic?.count || 0) : 0), 0);

        if (!topics.length || !items.length) {
            panel.hidden = true;
            target.innerHTML = '';
            meta.textContent = '';
            return;
        }

        panel.hidden = false;
        meta.textContent = criticalCount > 0
            ? `当前有 ${formatNumber(totalCount)} 项退款售后告警，其中 ${formatNumber(criticalCount)} 项需要立即人工对账。`
            : `当前有 ${formatNumber(totalCount)} 项退款售后告警，已同步管理员站内通知。`;

        target.innerHTML = topics.map((topic) => {
            const topicKey = String(topic?.key || '').trim().toLowerCase();
            const topicItems = items
                .filter((item) => String(item?.topic_key || '').trim().toLowerCase() === topicKey)
                .slice(0, 2);
            const tone = getRefundTopicTone(topic);
            return `
                <article class="payments-refund-topic-card severity-${escapeHtml(topic?.severity || 'warning')}">
                    <div class="payments-refund-topic-head">
                        <div class="payments-refund-topic-copy">
                            <div class="payments-refund-topic-title">
                                <i class="${escapeHtml(getRefundTopicIcon(topicKey))}"></i>
                                <span>${escapeHtml(topic?.label || '退款告警')}</span>
                            </div>
                            <div class="payments-refund-topic-description">${escapeHtml(topic?.description || '')}</div>
                        </div>
                        <div class="payments-provider-badges">
                            <span class="payments-mini-badge ${escapeHtml(tone)}">${escapeHtml(formatNumber(topic?.count || 0))} 项</span>
                            <button
                                type="button"
                                class="payments-anomaly-action-btn request_retry"
                                data-admin-action="payments-focus-exception-topic"
                                data-payments-topic-key="${escapeHtml(topicKey)}"
                            >
                                查看专题
                            </button>
                        </div>
                    </div>
                    <div class="payments-refund-alert-stream">
                        ${topicItems.length ? topicItems.map((item) => `
                            <div class="payments-refund-alert-item severity-${escapeHtml(item?.severity || 'warning')}">
                                <div class="payments-refund-alert-item-top">
                                    <div class="payments-refund-alert-item-copy">
                                        <strong>${escapeHtml(item?.title || '退款异常')}</strong>
                                        <span>${escapeHtml(item?.message || '')}</span>
                                    </div>
                                    <span class="payments-anomaly-severity">${escapeHtml(getSeverityLabel(item?.severity))}</span>
                                </div>
                                <div class="payments-refund-alert-item-meta">
                                    <span><small>订单号</small><strong>${escapeHtml(getAnomalyReferenceValue(item))}</strong></span>
                                    <span><small>通道</small><strong>${escapeHtml(getProviderLabel(item?.provider))}</strong></span>
                                    <span><small>时间</small><strong>${escapeHtml(formatDateTime(item?.created_at))}</strong></span>
                                </div>
                                ${renderAnomalyOpsState(item)}
                                <div class="payments-refund-alert-hint">${escapeHtml(getHandlingSuggestion(item))}</div>
                            </div>
                        `).join('') : `
                            <div class="payments-empty-state compact">当前专题暂无可展开的最新明细，请切到异常运维查看完整历史。</div>
                        `}
                    </div>
                </article>
            `;
        }).join('');
    }

    function renderOpsAlertQueue(data) {
        const panel = document.getElementById('paymentsOpsAlertQueuePanel');
        const target = document.getElementById('paymentsOpsAlertQueue');
        const meta = document.getElementById('paymentsOpsAlertQueueMeta');
        if (!panel || !target || !meta) return;

        const summary = data?.ops_alert_summary || {};
        const items = Array.isArray(data?.ops_alert_items) ? data.ops_alert_items : [];
        const total = Number(summary.total || 0);
        const deliveredCount = Math.max(0, Number(summary.delivered || 0) || 0);
        const pendingCount = Math.max(0, Number(summary.pending || 0) || 0);
        const retryCount = Math.max(0, Number(summary.retry || 0) || 0);
        const processingCount = Math.max(0, Number(summary.processing || 0) || 0);
        const deadLetterCount = Math.max(0, Number(summary.dead_letter || 0) || 0);
        const actionableCount = summary.actionable_count != null
            ? Math.max(0, Number(summary.actionable_count || 0) || 0)
            : pendingCount + retryCount + processingCount + deadLetterCount;

        panel.hidden = false;
        meta.textContent = total
            ? `当前范围内共 ${formatNumber(total)} 条站外告警任务，其中 ${formatNumber(deliveredCount)} 条已送达、${formatNumber(actionableCount)} 条待处理、${formatNumber(deadLetterCount)} 条死信、${formatNumber(retryCount)} 条等待重试。`
            : '当前时间范围内还没有站外告警任务。';

        if (!items.length) {
            target.innerHTML = '<div class="payments-empty-state">当前没有待处理的站外告警任务，后续如有死信或重试任务会在这里展示。</div>';
            return;
        }

        const split = splitItemsByResolution(items, (item) => item.queue_status);
        const activeItems = split.activeItems;
        const resolvedItems = split.resolvedItems;
        const handledItems = filterItemsByStatuses(resolvedItems, ['handled']);
        const ignoredItems = filterItemsByStatuses(resolvedItems, ['ignored']);

        target.innerHTML = `
            ${activeItems.length ? `
                <div class="payments-anomaly-items">
                    ${renderOpsAlertQueueItemsHtml(activeItems)}
                </div>
            ` : `
                <div class="payments-empty-state">
                    当前没有待处理的站外告警任务，已处理和已忽略记录都收在下方折叠区。
                </div>
            `}
            ${renderCollapsedHandledSection({
                title: '已处理',
                description: '已人工确认并结束的站外告警默认收起，避免队列持续向下堆叠。',
                badges: [
                    renderMiniCountBadge('已处理', summary.handled, 'success')
                ],
                body: handledItems.length ? `<div class="payments-anomaly-items">${renderOpsAlertQueueItemsHtml(handledItems)}</div>` : ''
            })}
            ${renderCollapsedHandledSection({
                title: '已忽略',
                description: '被人工判定为暂不继续跟进的站外告警会收在这里，仍可展开复查或重新打开。',
                badges: [
                    renderMiniCountBadge('已忽略', summary.ignored, 'muted')
                ],
                body: ignoredItems.length
                    ? `<div class="payments-anomaly-items">${renderOpsAlertQueueItemsHtml(ignoredItems)}</div>`
                    : '<div class="payments-empty-state compact">当前没有已忽略的站外告警。</div>'
            })}
        `;
    }

    function renderProviderStats(data) {
        const target = document.getElementById('paymentsProviderStats');
        if (!target) return;
        const providerStats = Array.isArray(data?.provider_stats) ? data.provider_stats : [];

        if (!providerStats.length) {
            target.innerHTML = '<div class="payments-empty-state">当前时间范围内暂无支付通道数据。</div>';
            return;
        }

        target.innerHTML = providerStats.map((item) => `
            <div class="payments-provider-row">
                <div class="payments-provider-copy">
                    <div class="payments-provider-name"><i class="${escapeHtml(getProviderIcon(item.provider))}"></i>${escapeHtml(getProviderLabel(item.provider))}</div>
                    <div class="payments-provider-meta">
                        ${escapeHtml(formatNumber(item.total_orders))} 单
                        · 支付成功 ${escapeHtml(formatPercent(item.paid_rate))}
                        · 认领 ${escapeHtml(formatPercent(item.claim_rate))}
                        · 意图匹配 ${escapeHtml(formatPercent(item.order_match_rate || item.session_match_rate))}
                        · webhook ${escapeHtml(formatPercent(item.webhook_success_rate || 0))}
                        · 查码 ${Number(item.query_total || 0) > 0 ? escapeHtml(formatPercent(item.query_success_rate || 0)) : '—'}
                    </div>
                    <div class="payments-provider-extra">
                        <span>${escapeHtml(formatCurrency(item.total_amount))}</span>
                        <span>${escapeHtml(formatPoints(item.total_points))}</span>
                        <span>会话 ${escapeHtml(formatNumber(item.session_total))} · 已匹配 ${escapeHtml(formatNumber(item.session_matched))}</span>
                        <span>自动回填 ${escapeHtml(formatPercent(item.auto_link_rate || 0))} · 人工/兜底 ${escapeHtml(formatPercent(item.fallback_link_rate || 0))}</span>
                    </div>
                </div>
                <div class="payments-provider-badges">
                    <span class="payments-mini-badge">${escapeHtml(formatNumber(item.review_orders))} 待审核</span>
                    <span class="payments-mini-badge danger">${escapeHtml(formatNumber(item.failed_orders))} 异常</span>
                    ${Number(item.session_stale || 0) > 0 ? `<span class="payments-mini-badge warning">${escapeHtml(formatNumber(item.session_stale))} 待回填</span>` : ''}
                    ${Number(item.session_failed || 0) > 0 ? `<span class="payments-mini-badge danger">${escapeHtml(formatNumber(item.session_failed))} 会话失败</span>` : ''}
                    ${Number(item.fallback_links || 0) > 0 ? `<span class="payments-mini-badge info">${escapeHtml(formatNumber(item.fallback_links))} 兜底</span>` : ''}
                    ${Number(item.webhook_4xx || 0) > 0 ? `<span class="payments-mini-badge warning">${escapeHtml(formatNumber(item.webhook_4xx))} webhook 4xx</span>` : ''}
                    ${Number(item.webhook_5xx || 0) > 0 ? `<span class="payments-mini-badge danger">${escapeHtml(formatNumber(item.webhook_5xx))} webhook 5xx</span>` : ''}
                    ${Number(item.query_failed || 0) > 0 ? `<span class="payments-mini-badge warning">${escapeHtml(formatNumber(item.query_failed))} 查码失败</span>` : ''}
                </div>
            </div>
        `).join('');
    }

    function renderSitewideSummary(data) {
        const target = document.getElementById('paymentsSitewideGrid');
        if (!target) return;

        const summary = data?.sitewide_summary || {};
        const cards = [
            {
                icon: 'fas fa-wallet',
                label: '充值收入',
                value: formatCurrency(summary.recharge_amount),
                help: `${formatNumber(summary.recharge_order_count)} 笔充值 · ${formatPoints(summary.recharge_points)} 已入账`
            },
            {
                icon: 'fas fa-store',
                label: '商城消耗',
                value: formatPoints(summary.shop_points_spent),
                help: `${formatNumber(summary.shop_order_count)} 笔消费 · 退款 ${formatPoints(summary.refunded_shop_points)}`
            },
            {
                icon: 'fas fa-flask',
                label: '模拟支付',
                value: `${formatNumber(summary.mock_recharge_order_count)} 笔`,
                help: `${formatPoints(summary.mock_recharge_points)} 已入账 · 用于和真实支付分开核对`,
                tone: 'mock'
            },
            {
                icon: 'fas fa-arrow-trend-up',
                label: '流入',
                value: formatPoints(summary.points_inflow),
                help: '包含充值、兑换码、奖励和管理入账'
            },
            {
                icon: 'fas fa-arrow-trend-down',
                label: '流出',
                value: formatPoints(summary.points_outflow),
                help: '包含商城消费、内容解锁、验证和管理扣减',
                tone: 'warning'
            },
            {
                icon: 'fas fa-scale-balanced',
                label: '净流动',
                value: formatSignedPoints(summary.net_points_flow),
                help: '流入减去流出后的净变化'
            },
            {
                icon: 'fas fa-coins',
                label: '当前流通余额',
                value: formatPoints(summary.circulating_points),
                help: `付费 ${formatPoints(summary.paid_balance)} · 奖励 ${formatPoints(summary.bonus_balance)}`
            }
        ];

        renderMetricCards(target, cards);
    }

    function getBusinessBreakdownKey(item) {
        return String(item?.key || '').trim().toLowerCase();
    }

    function getBusinessBreakdownTone(item) {
        const explicitTone = String(item?.tone || '').trim().toLowerCase();
        if (Object.prototype.hasOwnProperty.call(BUSINESS_BREAKDOWN_TONE_META, explicitTone)) {
            return explicitTone;
        }

        const key = getBusinessBreakdownKey(item);
        if (key === 'shop') return 'shop';
        if (key === 'shop_profit') return 'profit';
        if (key === 'mock') return 'mock';
        if (key === 'balance') return 'balance';
        return 'recharge';
    }

    function getBusinessBreakdownMetricKind(item) {
        const explicitKind = String(item?.metric_kind || item?.metricKind || '').trim().toLowerCase();
        if (explicitKind) return explicitKind;

        const key = getBusinessBreakdownKey(item);
        if (key === 'recharge') return 'currency';
        if (key === 'mock') return 'count';
        return 'points';
    }

    function getBusinessBreakdownTrendPoints(item) {
        return Array.isArray(item?.trend)
            ? item.trend
                .filter((point) => point && typeof point === 'object')
                .map((point) => ({
                    label: String(point.label || '').trim(),
                    value: Number(point.value || 0)
                }))
                .filter((point) => Number.isFinite(point.value))
            : [];
    }

    function formatBusinessBreakdownCount(value) {
        const num = Number(value || 0);
        if (!Number.isFinite(num)) return '0 笔';
        return `${num.toLocaleString('zh-CN', {
            minimumFractionDigits: num % 1 ? 1 : 0,
            maximumFractionDigits: 1
        })} 笔`;
    }

    function formatBusinessBreakdownTrendValue(kind, value) {
        if (kind === 'currency') {
            return formatCurrency(value);
        }
        if (kind === 'count') {
            return formatBusinessBreakdownCount(value);
        }
        return formatPoints(value);
    }

    function getBusinessBreakdownToneMeta(itemOrTone) {
        const tone = typeof itemOrTone === 'string'
            ? String(itemOrTone || '').trim().toLowerCase()
            : getBusinessBreakdownTone(itemOrTone);
        return BUSINESS_BREAKDOWN_TONE_META[tone] || BUSINESS_BREAKDOWN_TONE_META.recharge;
    }

    function formatBusinessBreakdownSignedValue(kind, value) {
        const num = Number(value || 0);
        if (!Number.isFinite(num)) {
            return formatBusinessBreakdownTrendValue(kind, 0);
        }

        const sign = num > 0 ? '+' : (num < 0 ? '-' : '');
        const absValue = Math.abs(num);
        if (kind === 'currency') {
            return `${sign}${formatCurrency(absValue)}`;
        }
        if (kind === 'count') {
            return `${sign}${formatBusinessBreakdownCount(absValue)}`;
        }
        return `${sign}${formatPoints(absValue)}`;
    }

    function getBusinessBreakdownDeltaDirection(value) {
        const num = Number(value || 0);
        if (!Number.isFinite(num) || Math.abs(num) < 0.0001) {
            return 'flat';
        }
        return num > 0 ? 'up' : 'down';
    }

    function getBusinessBreakdownDeltaText(item) {
        const direction = getBusinessBreakdownDeltaDirection(item?.delta);
        if (direction === 'flat') {
            return '较前一日持平';
        }
        return `较前一日 ${formatBusinessBreakdownSignedValue(getBusinessBreakdownMetricKind(item), item?.delta)}`;
    }

    function buildBusinessBreakdownItems(data) {
        const items = Array.isArray(data?.business_breakdown) ? data.business_breakdown : [];
        return items.map((item, index) => {
            const trend = getBusinessBreakdownTrendPoints(item);
            const values = trend.map((point) => Number(point.value || 0));
            const latest = values.length ? values[values.length - 1] : 0;
            const previous = values.length > 1 ? values[values.length - 2] : latest;
            const average = values.length ? (values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
            const peak = values.length ? Math.max(...values) : latest;
            const key = getBusinessBreakdownKey(item) || `business-${index + 1}`;
            const tone = getBusinessBreakdownTone(item);
            const metricKind = getBusinessBreakdownMetricKind(item);

            return {
                ...item,
                key,
                tone,
                metricKind,
                trend,
                latest,
                latestLabel: trend[trend.length - 1]?.label || '当前',
                average,
                peak,
                delta: latest - previous
            };
        });
    }

    function buildBusinessBreakdownLabels(items) {
        const labels = [];
        const seen = new Set();

        items.forEach((item) => {
            (item?.trend || []).forEach((point) => {
                const label = String(point?.label || '').trim();
                if (!label || seen.has(label)) return;
                seen.add(label);
                labels.push(label);
            });
        });

        return labels;
    }

    function getBusinessBreakdownSeriesValues(item, labels) {
        const valueMap = new Map(
            (item?.trend || []).map((point) => [
                String(point?.label || '').trim(),
                Number(point?.value || 0)
            ])
        );

        return labels.map((label) => {
            const value = valueMap.get(label);
            return Number.isFinite(value) ? value : 0;
        });
    }

    function buildBusinessBreakdownTickIndexes(totalCount, preferredCount = 6) {
        const total = Number(totalCount || 0);
        if (total <= 0) return [];
        if (total <= preferredCount) {
            return Array.from({ length: total }, (_, index) => index);
        }

        const step = Math.max(1, Math.ceil((total - 1) / Math.max(1, preferredCount - 1)));
        const indexes = new Set([0, total - 1]);
        for (let index = 0; index < total; index += step) {
            indexes.add(index);
        }

        return Array.from(indexes).sort((left, right) => left - right);
    }

    function getResolvedBusinessBreakdownFocusKey(items) {
        const keys = new Set((items || []).map((item) => item.key));
        if (keys.has(state.businessBreakdownFocusKey)) {
            return state.businessBreakdownFocusKey;
        }
        return 'all';
    }

    function buildBusinessBreakdownSmoothPath(points) {
        if (!Array.isArray(points) || !points.length) return '';
        if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

        return points.reduce((path, point, index) => {
            if (index === 0) {
                return `M ${point.x} ${point.y}`;
            }

            const previousPoint = points[index - 1];
            const midX = Number(((previousPoint.x + point.x) / 2).toFixed(2));
            return `${path} C ${midX} ${previousPoint.y}, ${midX} ${point.y}, ${point.x} ${point.y}`;
        }, '');
    }

    function buildBusinessBreakdownChartModel(items) {
        const labels = buildBusinessBreakdownLabels(items);
        const focusKey = getResolvedBusinessBreakdownFocusKey(items);
        const mode = 'normalized';
        const chartItems = items;
        const focusedItem = focusKey === 'all'
            ? null
            : items.find((item) => item.key === focusKey) || null;
        const width = 1040;
        const height = 340;
        const chartLeft = 66;
        const chartRight = 24;
        const chartTop = 24;
        const chartBottom = 40;
        const plotWidth = Math.max(0, width - chartLeft - chartRight);
        const plotHeight = Math.max(0, height - chartTop - chartBottom);
        const xPositions = labels.map((label, index) => {
            const x = labels.length === 1
                ? chartLeft + (plotWidth / 2)
                : chartLeft + ((plotWidth * index) / Math.max(1, labels.length - 1));
            return {
                label,
                index,
                x: Number(x.toFixed(2))
            };
        });
        const xTickIndexes = buildBusinessBreakdownTickIndexes(labels.length, 6);
        const series = chartItems.map((item) => {
            const meta = getBusinessBreakdownToneMeta(item);
            const values = getBusinessBreakdownSeriesValues(item, labels);
            const minValue = values.length ? Math.min(...values) : 0;
            const maxValue = values.length ? Math.max(...values) : 0;
            const rawRange = maxValue - minValue;
            const pad = rawRange > 0
                ? rawRange * 0.08
                : Math.max(1, Math.abs(maxValue) * 0.08 || 1);
            const scaleMin = rawRange > 0 ? (minValue - pad) : (minValue - pad);
            const scaleMax = rawRange > 0 ? (maxValue + pad) : (maxValue + pad);
            const scaleRange = Math.max(scaleMax - scaleMin, 1);
            const points = values.map((value, index) => {
                const ratio = (value - scaleMin) / scaleRange;
                const y = chartTop + plotHeight - (ratio * plotHeight);
                return {
                    index,
                    label: labels[index] || '',
                    value,
                    x: xPositions[index]?.x ?? chartLeft,
                    y: Number(y.toFixed(2))
                };
            });
            const linePath = buildBusinessBreakdownSmoothPath(points);
            const areaPath = points.length
                ? `${linePath} L ${points[points.length - 1].x} ${chartTop + plotHeight} L ${points[0].x} ${chartTop + plotHeight} Z`
                : '';

            return {
                ...item,
                meta,
                values,
                scaleMin,
                scaleMax,
                isFocused: focusKey !== 'all' && item.key === focusKey,
                isMuted: focusKey !== 'all' && item.key !== focusKey,
                showArea: focusKey !== 'all' && item.key === focusKey,
                points,
                linePath,
                areaPath
            };
        });

        const yTicks = [100, 75, 50, 25, 0].map((value, index) => ({
            label: `${value}%`,
            y: Number((chartTop + (plotHeight * (index / 4))).toFixed(2))
        }));

        return {
            focusKey,
            mode,
            focusedItem,
            labels,
            series,
            width,
            height,
            chartLeft,
            chartRight,
            chartTop,
            chartBottom,
            plotWidth,
            plotHeight,
            xPositions,
            xTickIndexes,
            yTicks,
            rangeLabel: labels.length ? `最近 ${labels.length} 个观察日` : '暂无观察日',
            modeLabel: focusedItem ? `聚焦 ${focusedItem.title || '业务项'}` : '多序列对比',
            note: focusedItem
                ? `已聚焦 ${focusedItem.title || '当前业务项'}，其它曲线保留走势并淡化显示。`
                : '当前为多序列对比模式，各曲线按自身区间缩放，便于对比走势起伏。'
        };
    }

    function getBusinessBreakdownActiveIndex(model) {
        if (!model?.labels?.length) return -1;
        const index = Number(state.businessBreakdownHoverIndex);
        if (Number.isInteger(index) && index >= 0 && index < model.labels.length) {
            return index;
        }
        return model.labels.length - 1;
    }

    function renderBusinessBreakdownSummaryCards(items) {
        const focusKey = getResolvedBusinessBreakdownFocusKey(items);
        return `
            <div class="payments-business-summary-grid">
                ${items.map((item) => {
                    const toneMeta = getBusinessBreakdownToneMeta(item);
                    const deltaDirection = getBusinessBreakdownDeltaDirection(item.delta);
                    const isActive = focusKey === item.key;
                    const isMuted = focusKey !== 'all' && !isActive;
                    return `
                        <button
                            type="button"
                            class="payments-business-summary-card${isActive ? ' is-active' : ''}${isMuted ? ' is-muted' : ''}"
                            data-payments-business-focus-key="${escapeHtml(item.key)}"
                            aria-pressed="${isActive ? 'true' : 'false'}"
                            style="--payments-business-accent:${toneMeta.color}; --payments-business-accent-fill:${toneMeta.fill}; --payments-business-accent-glow:${toneMeta.glow};"
                        >
                            <span class="payments-business-summary-card__icon">
                                <i class="${escapeHtml(toneMeta.icon)}"></i>
                            </span>
                            <span class="payments-business-summary-card__copy">
                                <span class="payments-business-summary-card__title">${escapeHtml(item.title || '业务项')}</span>
                                <strong class="payments-business-summary-card__metric">${escapeHtml(item.metric || '—')}</strong>
                                <span class="payments-business-summary-card__meta">${escapeHtml(item.meta || item.description || '当前暂无补充说明')}</span>
                                <span class="payments-business-summary-card__foot">
                                    <span class="payments-business-summary-card__latest">最近 ${escapeHtml(item.latestLabel)} · ${escapeHtml(formatBusinessBreakdownTrendValue(item.metricKind, item.latest))}</span>
                                    <span class="payments-business-summary-card__delta trend-${escapeHtml(deltaDirection)}">${escapeHtml(getBusinessBreakdownDeltaText(item))}</span>
                                </span>
                            </span>
                        </button>
                    `;
                }).join('')}
            </div>
        `;
    }

    function renderBusinessBreakdownLegend(items) {
        const focusKey = getResolvedBusinessBreakdownFocusKey(items);
        return `
            <div class="payments-business-legend">
                <button
                    type="button"
                    class="payments-business-legend-btn${focusKey === 'all' ? ' is-active' : ''}"
                    data-payments-business-focus-key="all"
                    aria-pressed="${focusKey === 'all' ? 'true' : 'false'}"
                    style="--payments-business-accent:${BUSINESS_BREAKDOWN_TONE_META.all.color};"
                >
                    <span class="payments-business-legend-dot"></span>
                    <span>全部走势</span>
                </button>
                ${items.map((item) => {
                    const toneMeta = getBusinessBreakdownToneMeta(item);
                    const isActive = focusKey === item.key;
                    const isMuted = focusKey !== 'all' && !isActive;
                    return `
                        <button
                            type="button"
                            class="payments-business-legend-btn${isActive ? ' is-active' : ''}${isMuted ? ' is-muted' : ''}"
                            data-payments-business-focus-key="${escapeHtml(item.key)}"
                            aria-pressed="${isActive ? 'true' : 'false'}"
                            style="--payments-business-accent:${toneMeta.color};"
                        >
                            <span class="payments-business-legend-dot"></span>
                            <span>${escapeHtml(item.title || '业务项')}</span>
                        </button>
                    `;
                }).join('')}
            </div>
        `;
    }

    function renderBusinessBreakdownInspector(model, items) {
        const activeIndex = getBusinessBreakdownActiveIndex(model);
        const activeLabel = model?.labels?.[activeIndex] || '当前';
        const focusKey = getResolvedBusinessBreakdownFocusKey(items);
        const orderedItems = focusKey === 'all'
            ? items
            : [
                ...items.filter((item) => item.key === focusKey),
                ...items.filter((item) => item.key !== focusKey)
            ];

        return `
            <div class="payments-business-trend-inspector__head">
                <span class="payments-business-trend-inspector__eyebrow">${escapeHtml(model.modeLabel || '走势')}</span>
                <strong class="payments-business-trend-inspector__label">${escapeHtml(activeLabel)}</strong>
                <span class="payments-business-trend-inspector__note">${escapeHtml(model.note || '')}</span>
            </div>
            <div class="payments-business-trend-inspector__rows">
                ${orderedItems.map((item) => {
                    const meta = getBusinessBreakdownToneMeta(item);
                    const values = getBusinessBreakdownSeriesValues(item, model.labels || []);
                    const currentValue = values[activeIndex] ?? item.latest ?? 0;
                    const previousValue = activeIndex > 0 ? (values[activeIndex - 1] ?? currentValue) : currentValue;
                    const delta = currentValue - previousValue;
                    const deltaDirection = getBusinessBreakdownDeltaDirection(delta);
                    return `
                        <button
                            type="button"
                            class="payments-business-trend-inspector__row${focusKey === item.key ? ' is-active' : ''}${focusKey !== 'all' && focusKey !== item.key ? ' is-muted' : ''}"
                            data-payments-business-focus-key="${escapeHtml(item.key)}"
                            aria-pressed="${focusKey === item.key ? 'true' : 'false'}"
                            style="--payments-business-accent:${meta.color};"
                        >
                            <span class="payments-business-trend-inspector__series">
                                <span class="payments-business-trend-inspector__dot" style="--payments-business-accent:${meta.color};"></span>
                                <span>${escapeHtml(item.title || '业务项')}</span>
                            </span>
                            <span class="payments-business-trend-inspector__value">${escapeHtml(formatBusinessBreakdownTrendValue(item.metricKind, currentValue))}</span>
                            <span class="payments-business-trend-inspector__delta trend-${escapeHtml(deltaDirection)}">${escapeHtml(deltaDirection === 'flat' ? '持平' : formatBusinessBreakdownSignedValue(item.metricKind, delta))}</span>
                        </button>
                    `;
                }).join('')}
            </div>
        `;
    }

    function renderBusinessBreakdownChartPanel(model, items) {
        if (!model.labels.length) {
            return '<div class="payments-breakdown-chart-empty">当前范围内暂无按天走势。</div>';
        }

        const hitareaStyle = [
            `left:${((model.chartLeft / model.width) * 100).toFixed(4)}%`,
            `right:${((model.chartRight / model.width) * 100).toFixed(4)}%`,
            `top:${((model.chartTop / model.height) * 100).toFixed(4)}%`,
            `bottom:${((model.chartBottom / model.height) * 100).toFixed(4)}%`,
            `--payments-business-columns:${Math.max(1, model.labels.length)}`
        ].join('; ');

        return `
            <div class="payments-business-trend-panel">
                <div class="payments-business-trend-head">
                    <div class="payments-business-trend-heading">
                        <div class="payments-business-trend-title">近窗趋势</div>
                        <div class="payments-business-trend-subtitle">按日观察业务收支与余额变化，点选图例或右侧清单可聚焦单根曲线。</div>
                    </div>
                    <div class="payments-business-trend-range">
                        <strong>${escapeHtml(model.rangeLabel)}</strong>
                        <span>${escapeHtml(model.modeLabel)}</span>
                    </div>
                </div>
                ${renderBusinessBreakdownLegend(items)}
                <div class="payments-business-trend-body">
                    <div class="payments-business-trend-plot-shell">
                        <div class="payments-business-trend-chart-note">${escapeHtml(model.note)}</div>
                        <div class="payments-business-trend-plot-frame">
                            <svg class="payments-business-trend-svg" viewBox="0 0 ${model.width} ${model.height}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
                                <rect class="payments-business-trend-plot-bg" x="${model.chartLeft}" y="${model.chartTop}" width="${model.plotWidth}" height="${model.plotHeight}" rx="18"></rect>
                                ${model.yTicks.map((tick) => `
                                    <g class="payments-business-trend-grid-row">
                                        <line class="payments-business-trend-grid-line" x1="${model.chartLeft}" y1="${tick.y}" x2="${model.width - model.chartRight}" y2="${tick.y}"></line>
                                        <text class="payments-business-trend-grid-label" x="${model.chartLeft - 12}" y="${tick.y + 4}" text-anchor="end">${escapeHtml(tick.label)}</text>
                                    </g>
                                `).join('')}
                                <line
                                    class="payments-business-trend-guide"
                                    data-payments-business-guide
                                    x1="${model.xPositions[getBusinessBreakdownActiveIndex(model)]?.x ?? model.chartLeft}"
                                    y1="${model.chartTop}"
                                    x2="${model.xPositions[getBusinessBreakdownActiveIndex(model)]?.x ?? model.chartLeft}"
                                    y2="${model.chartTop + model.plotHeight}"
                                ></line>
                                ${model.series.map((series) => `
                                    <g class="payments-business-trend-series${series.isFocused ? ' is-focused' : ''}${series.isMuted ? ' is-muted' : ''}" data-payments-business-series-key="${escapeHtml(series.key)}">
                                        ${series.showArea && series.areaPath
                                            ? `<path class="payments-business-trend-area" d="${series.areaPath}" style="--payments-business-series-color:${series.meta.color}; --payments-business-series-fill:${series.meta.fill};"></path>`
                                            : ''}
                                        <path class="payments-business-trend-line" d="${series.linePath}" style="--payments-business-series-color:${series.meta.color}; --payments-business-series-glow:${series.meta.glow};"></path>
                                    </g>
                                `).join('')}
                                ${model.xTickIndexes.map((tickIndex) => `
                                    <text
                                        class="payments-business-trend-axis-label"
                                        x="${model.xPositions[tickIndex]?.x ?? model.chartLeft}"
                                        y="${model.height - 10}"
                                        text-anchor="middle"
                                    >${escapeHtml(model.labels[tickIndex] || '')}</text>
                                `).join('')}
                            </svg>
                            <div class="payments-business-trend-point-layer" aria-hidden="true">
                                ${model.series.map((series) => series.points.map((point) => `
                                    <span
                                        class="payments-business-trend-point"
                                        data-payments-business-point-index="${point.index}"
                                        data-payments-business-point-key="${escapeHtml(series.key)}"
                                        style="left:${((point.x / model.width) * 100).toFixed(4)}%; top:${((point.y / model.height) * 100).toFixed(4)}%; --payments-business-series-color:${series.meta.color};"
                                    ></span>
                                `).join('')).join('')}
                            </div>
                            <div
                                class="payments-business-trend-hitareas"
                                style="${hitareaStyle};"
                            >
                                ${model.labels.map((label, index) => `
                                    <button
                                        type="button"
                                        class="payments-business-trend-hitarea"
                                        data-payments-business-index="${index}"
                                        aria-label="${escapeHtml(label)}"
                                    ></button>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                    <div class="payments-business-trend-inspector" data-payments-business-inspector></div>
                </div>
            </div>
        `;
    }

    function renderBusinessBreakdownTable(items) {
        const focusKey = getResolvedBusinessBreakdownFocusKey(items);
        return `
            <div class="payments-business-table-panel">
                <div class="payments-business-table-head">
                    <div class="payments-business-table-title">拆分明细</div>
                    <div class="payments-business-table-note">保留最近观测、日均、峰值和走势摘要，汇总数已移到顶部总览。</div>
                </div>
                <div class="payments-business-table-wrap">
                    <table class="payments-business-table">
                        <thead>
                            <tr>
                                <th>业务项</th>
                                <th>最近观测</th>
                                <th>日均</th>
                                <th>峰值</th>
                                <th>走势摘要</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${items.map((item) => {
                                const toneMeta = getBusinessBreakdownToneMeta(item);
                                const deltaDirection = getBusinessBreakdownDeltaDirection(item.delta);
                                return `
                                    <tr
                                        class="payments-business-table-row${focusKey === item.key ? ' is-focused' : ''}${focusKey !== 'all' && focusKey !== item.key ? ' is-muted' : ''}"
                                        data-payments-business-row-key="${escapeHtml(item.key)}"
                                        style="--payments-business-accent:${toneMeta.color};"
                                    >
                                        <td>
                                            <div class="payments-business-table-label">
                                                <span class="payments-business-table-dot"></span>
                                                <div class="payments-business-table-copy">
                                                    <strong>${escapeHtml(item.title || '业务项')}</strong>
                                                    <span>${escapeHtml(item.description || item.help || '—')}</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td>
                                            <div class="payments-business-table-value">
                                                <strong>${escapeHtml(formatBusinessBreakdownTrendValue(item.metricKind, item.latest))}</strong>
                                                <span>${escapeHtml(item.latestLabel || '当前')}</span>
                                            </div>
                                        </td>
                                        <td>${escapeHtml(formatBusinessBreakdownTrendValue(item.metricKind, item.average))}</td>
                                        <td>${escapeHtml(formatBusinessBreakdownTrendValue(item.metricKind, item.peak))}</td>
                                        <td>
                                            <div class="payments-business-table-trend">
                                                <span class="payments-business-table-trend-chip trend-${escapeHtml(deltaDirection)}">${escapeHtml(deltaDirection === 'flat' ? '持平' : (deltaDirection === 'up' ? '抬升' : '回落'))}</span>
                                                <span>${escapeHtml(getBusinessBreakdownDeltaText(item))}</span>
                                            </div>
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    function getShopProfitSummary(data) {
        const sitewideSummary = normalizePaymentsContextObject(data?.sitewide_summary);
        return normalizePaymentsContextObject(sitewideSummary.shop_profit_summary);
    }

    function hasShopProfitAuditSummary(summary = {}) {
        return [
            'order_count',
            'recognized_revenue_cny',
            'recognized_cost_cny',
            'net_profit_cny',
            'paid_points_spent',
            'bonus_points_spent',
            'untracked_revenue_points',
            'inventory_item_count'
        ].some((key) => Number.isFinite(Number(summary?.[key])) && Number(summary[key]) !== 0);
    }

    function normalizeShopProfitIssueTone(tone) {
        const normalized = String(tone || '').trim().toLowerCase();
        return ['critical', 'warning', 'info', 'review', 'ready'].includes(normalized) ? normalized : 'info';
    }

    function formatShopProfitIssueMetric(issue = {}) {
        const type = String(issue.type || '').trim().toLowerCase();
        const amount = Number(issue.amount_cny || 0);
        const points = Number(issue.points || 0);

        if (type === 'negative_profit') {
            return `亏损 ${formatCurrency(amount)}`;
        }
        if (type === 'missing_cost' || type === 'no_inventory') {
            return `影响收入 ${formatCurrency(amount)}`;
        }
        if (type === 'untracked_points') {
            return `未拆分 ${formatPrecisePoints(points)} 积分`;
        }
        if (type === 'bonus_points') {
            return `非现金 ${formatPrecisePoints(points)} 积分`;
        }
        if (type === 'refunded') {
            return `退款 ${formatPrecisePoints(points)} 积分`;
        }

        if (points > 0) {
            return `${formatPrecisePoints(points)} 积分`;
        }
        if (amount > 0) {
            return formatCurrency(amount);
        }
        return `${formatNumber(issue.count || issue.order_count || 0)} 项`;
    }

    function renderShopProfitIssueSamples(issue = {}) {
        const samples = Array.isArray(issue.sample_orders)
            ? issue.sample_orders.filter(Boolean).slice(0, 4)
            : [];

        if (!samples.length) return '';

        return `
            <div class="payments-shop-profit-audit__issue-samples">
                ${samples.map((sample) => {
                    const detailParts = [
                        sample.created_at ? formatDateTime(sample.created_at) : '',
                        `净利 ${formatCurrency(sample.net_profit_cny)}`,
                        Number(sample.missing_cost_item_count || 0) > 0 ? `缺成本 ${formatNumber(sample.missing_cost_item_count)} 件` : '',
                        Number(sample.untracked_revenue_points || 0) > 0 ? `未拆分 ${formatPrecisePoints(sample.untracked_revenue_points)} 积分` : '',
                        Number(sample.bonus_points_spent || 0) > 0 ? `非现金 ${formatPrecisePoints(sample.bonus_points_spent)} 积分` : '',
                        sample.point_source_traceability_label ? `来源 ${sample.point_source_traceability_label}` : '',
                        sample.refunded ? '已退款' : ''
                    ].filter(Boolean);

                    return `
                        <span>
                            <strong>${escapeHtml(sample.order_no || sample.order_id || '未知订单')}</strong>
                            <em>${escapeHtml(sample.product_name || '未命名商品')}</em>
                            <small>${escapeHtml(detailParts.join(' · '))}</small>
                        </span>
                    `;
                }).join('')}
            </div>
        `;
    }

    function renderShopProfitResolutionPlan(plan = {}) {
        const normalizedPlan = normalizePaymentsContextObject(plan);
        const label = String(normalizedPlan.label || '').trim();
        const primaryAction = String(normalizedPlan.primary_action || '').trim();
        const description = String(normalizedPlan.description || '').trim();
        const treatment = String(normalizedPlan.settlement_treatment || '').trim();
        const options = Array.isArray(normalizedPlan.options)
            ? normalizedPlan.options.filter(Boolean).slice(0, 4)
            : [];
        const tone = normalizeShopProfitIssueTone(normalizedPlan.tone || normalizedPlan.status);

        if (!label && !primaryAction && !description && !options.length) {
            return '';
        }

        return `
            <div class="payments-shop-profit-audit__resolution is-${escapeHtml(tone)}">
                <div class="payments-shop-profit-audit__resolution-head">
                    <span>处置路径</span>
                    <strong>${escapeHtml(label || '待复核')}</strong>
                </div>
                ${description || primaryAction || treatment ? `
                    <div class="payments-shop-profit-audit__resolution-copy">
                        ${description ? `<span>${escapeHtml(description)}</span>` : ''}
                        ${primaryAction ? `<strong>${escapeHtml(primaryAction)}</strong>` : ''}
                        ${treatment ? `<em>${escapeHtml(treatment)}</em>` : ''}
                    </div>
                ` : ''}
                ${options.length ? `
                    <div class="payments-shop-profit-audit__resolution-options">
                        ${options.map((option) => `
                            <span title="${escapeHtml(option.description || '')}">
                                <strong>${escapeHtml(option.label || option.key || '处理')}</strong>
                                ${option.next_state ? `<em>${escapeHtml(option.next_state)}</em>` : ''}
                            </span>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    }

    function renderShopProfitReadiness(summary = {}) {
        const readiness = normalizePaymentsContextObject(summary.profit_readiness);
        const items = Array.isArray(readiness.items) ? readiness.items.filter(Boolean).slice(0, 4) : [];
        if (!readiness.status && !items.length) return '';

        const tone = normalizeShopProfitIssueTone(readiness.status);
        const label = String(readiness.label || '').trim() || (tone === 'ready' ? '可结算' : '待复核');

        return `
            <div class="payments-shop-profit-audit__readiness is-${escapeHtml(tone)}" aria-label="商城利润结算就绪度">
                <div class="payments-shop-profit-audit__readiness-score">
                    <span>结算就绪度</span>
                    <strong>${escapeHtml(formatNumber(readiness.score ?? 0))}</strong>
                    <em>${escapeHtml(label)}</em>
                </div>
                <div class="payments-shop-profit-audit__readiness-list">
                    ${items.map((item) => {
                        const itemTone = normalizeShopProfitIssueTone(item.severity || item.status);
                        return `
                            <div class="payments-shop-profit-audit__readiness-item is-${escapeHtml(itemTone)}">
                                <strong>${escapeHtml(item.label || '审计项')}</strong>
                                <span>${escapeHtml([item.value_label || '', item.action_label || item.description || ''].filter(Boolean).join(' · '))}</span>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    function renderShopProfitReconciliationIssues(issues = []) {
        const safeIssues = Array.isArray(issues) ? issues.filter(Boolean).slice(0, 6) : [];
        if (!safeIssues.length) return '';

        return `
            <div class="payments-shop-profit-audit__issues" aria-label="商城利润闭环异常">
                <div class="payments-shop-profit-audit__issues-head">
                    <strong>闭环异常</strong>
                    <span>按订单利润归因自动汇总，优先处理红/黄项</span>
                </div>
                <div class="payments-shop-profit-audit__issue-list">
                    ${safeIssues.map((issue) => {
                        const tone = normalizeShopProfitIssueTone(issue.tone);
                        return `
                            <div class="payments-shop-profit-audit__issue is-${escapeHtml(tone)}">
                                <div class="payments-shop-profit-audit__issue-main">
                                    <div>
                                        <strong>${escapeHtml(issue.title || '闭环项')}</strong>
                                        <span>${escapeHtml(issue.description || '需要进一步核对。')}</span>
                                    </div>
                                    <em>${escapeHtml(formatShopProfitIssueMetric(issue))}</em>
                                </div>
                                <div class="payments-shop-profit-audit__issue-meta">
                                    <span>${escapeHtml(formatNumber(issue.order_count || 0))} 笔订单</span>
                                    <span>${escapeHtml(formatNumber(issue.count || 0))} 个对象</span>
                                </div>
                                ${renderShopProfitIssueSamples(issue)}
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    function formatShopProfitAuditAlertMetric(alert = {}) {
        const metricLabel = String(alert.metric_label || '').trim();
        if (metricLabel) return metricLabel;

        const amount = Number(alert.amount_cny || 0);
        const points = Number(alert.points || 0);
        if (points > 0) return `${formatPrecisePoints(points)} 积分`;
        if (amount > 0) return formatCurrency(amount);
        return `${formatNumber(alert.order_count || alert.affected_order_count || 0)} 笔`;
    }

    function getShopProfitAuditTargetLabel(value = '') {
        const normalized = String(value || '').trim().toLowerCase();
        const map = {
            negative_profit: '负利润订单',
            missing_cost: '采购成本未闭环',
            no_inventory: '订单未关联库存',
            point_source_coverage: '积分批次覆盖不足',
            untracked_points: '积分来源未拆分',
            profit_ledger_incomplete: '利润分录待补齐',
            profit_adjustments_review: '利润调整项需复核',
            bonus_points: '非现金积分消耗',
            refunded: '退款订单冲销'
        };
        return map[normalized] || String(value || '商城利润审计').trim() || '商城利润审计';
    }

    function renderShopProfitAuditAlerts(summary = {}) {
        const alerts = normalizePaymentsContextObject(summary.shop_profit_audit_alerts);
        const items = Array.isArray(alerts.items) ? alerts.items.filter(Boolean).slice(0, 8) : [];
        if (!items.length) return '';

        return `
            <div class="payments-shop-profit-audit__alerts" aria-label="商城利润审计告警">
                <div class="payments-shop-profit-audit__alerts-head">
                    <strong>审计告警</strong>
                    <span>优先处理 ${escapeHtml(formatNumber(alerts.action_required_count || 0))} 项 · 红色 ${escapeHtml(formatNumber(alerts.critical_count || 0))} / 黄色 ${escapeHtml(formatNumber(alerts.warning_count || 0))}</span>
                </div>
                <div class="payments-shop-profit-audit__alert-list">
                    ${items.map((alert) => {
                        const tone = normalizeShopProfitIssueTone(alert.severity || alert.tone);
                        const metaParts = [
                            `${formatNumber(alert.order_count || alert.affected_order_count || 0)} 笔订单`,
                            alert.action_label || '',
                            alert.case_target_id ? `审计项：${getShopProfitAuditTargetLabel(alert.case_target_id)}` : ''
                        ].filter(Boolean);

                        return `
                            <div class="payments-shop-profit-audit__alert is-${escapeHtml(tone)}">
                                <div class="payments-shop-profit-audit__alert-main">
                                    <div>
                                        <strong>${escapeHtml(alert.title || '审计告警')}</strong>
                                        <span>${escapeHtml(alert.description || '需要进一步核对。')}</span>
                                    </div>
                                    <em>${escapeHtml(formatShopProfitAuditAlertMetric(alert))}</em>
                                </div>
                                <div class="payments-shop-profit-audit__alert-meta">
                                    ${metaParts.map((part) => `<span>${escapeHtml(part)}</span>`).join('')}
                                </div>
                                ${renderShopProfitResolutionPlan(alert.resolution_plan)}
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    function renderShopProfitHistoricalDisposition(summary = {}) {
        const disposition = normalizePaymentsContextObject(summary.historical_order_disposition);
        const lanes = Array.isArray(disposition.lanes) ? disposition.lanes.filter(Boolean).slice(0, 5) : [];
        if (!lanes.length) return '';

        const tone = normalizeShopProfitIssueTone(disposition.status);
        return `
            <div class="payments-shop-profit-audit__history-disposition is-${escapeHtml(tone)}" aria-label="历史风险订单收口路径">
                <div class="payments-shop-profit-audit__history-head">
                    <div>
                        <strong>历史风险收口</strong>
                        <span>旧订单按“可补齐 / 历史估算 / 不可追溯归档”分层处理，避免永久堆在新风险里</span>
                    </div>
                    <em>${escapeHtml(disposition.label || '待收口')} · ${escapeHtml(formatNumber(disposition.action_required_count || 0))} 项</em>
                </div>
                <div class="payments-shop-profit-audit__history-lanes">
                    ${lanes.map((lane) => {
                        const laneTone = normalizeShopProfitIssueTone(lane.tone || disposition.status);
                        return `
                            <div class="payments-shop-profit-audit__history-lane is-${escapeHtml(laneTone)}">
                                <div>
                                    <strong>${escapeHtml(lane.label || '处置项')}</strong>
                                    <span>${escapeHtml(lane.description || '按该路径收口历史订单。')}</span>
                                </div>
                                <em>${escapeHtml(formatNumber(lane.count || 0))}</em>
                                <small>${escapeHtml(lane.action_label || '继续复核')}</small>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    function getShopProfitClosureStatusLabel(status = '') {
        const normalized = String(status || '').trim().toLowerCase();
        if (normalized === 'critical') return '需立即处理';
        if (normalized === 'warning') return '待补齐';
        return '已闭环';
    }

    function getShopProfitClosureCategoryLabel(category = '') {
        const normalized = String(category || '').trim().toLowerCase();
        const map = {
            payment: '支付链路',
            points: '积分链路',
            revenue: '收入链路',
            shop_order: '订单链路',
            procurement: '采购链路',
            adjustment: '调整链路',
            ledger: '分录链路',
            audit: '审计链路',
            reconciliation: '对账链路'
        };
        return map[normalized] || '对账链路';
    }

    function renderShopProfitReconciliationClosure(summary = {}) {
        const closure = normalizePaymentsContextObject(summary.profit_reconciliation_closure);
        const items = Array.isArray(closure.items) ? closure.items.filter(Boolean) : [];
        if (!items.length) return '';

        const status = String(closure.status || '').trim().toLowerCase();
        const tone = normalizeShopProfitIssueTone(status === 'ready' ? 'ready' : status);
        const statusLabel = getShopProfitClosureStatusLabel(status);

        return `
            <div class="payments-shop-profit-audit__closure" aria-label="商城利润对账闭环">
                <div class="payments-shop-profit-audit__closure-head">
                    <div>
                        <strong>对账闭环</strong>
                        <span>支付到账、积分来源、采购成本、调整项、分录与告警逐项校验</span>
                    </div>
                    <em class="is-${escapeHtml(tone)}">${escapeHtml(statusLabel)} · ${escapeHtml(formatNumber(closure.action_required_count || 0))} 项待处理</em>
                </div>
                <div class="payments-shop-profit-audit__closure-grid">
                    ${items.map((item) => {
                        const itemTone = normalizeShopProfitIssueTone(item.tone || item.status);
                        const metaParts = [
                            getShopProfitClosureCategoryLabel(item.category),
                            item.order_count ? `${formatNumber(item.order_count)} 笔订单` : '',
                            Number(item.amount_cny || 0) ? formatCurrency(Math.abs(Number(item.amount_cny || 0))) : '',
                            Number(item.points || 0) ? `${formatPrecisePoints(item.points)} 积分` : '',
                            item.action_label || ''
                        ].filter(Boolean);

                        return `
                            <div class="payments-shop-profit-audit__closure-item is-${escapeHtml(itemTone)}">
                                <div class="payments-shop-profit-audit__closure-main">
                                    <div>
                                        <strong>${escapeHtml(item.label || '对账项')}</strong>
                                        <span>${escapeHtml(item.description || '已纳入商城净利润对账闭环。')}</span>
                                    </div>
                                    <em>${escapeHtml(item.value_label || getShopProfitClosureStatusLabel(item.status))}</em>
                                </div>
                                <div class="payments-shop-profit-audit__closure-meta">
                                    <span>${escapeHtml(getShopProfitClosureStatusLabel(item.status))}</span>
                                    ${metaParts.map((part) => `<span>${escapeHtml(part)}</span>`).join('')}
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    function getShopProfitOrderRiskStatusLabel(risk = '') {
        if (risk && typeof risk === 'object') {
            const explicitLabel = String(risk.status_label || risk.statusLabel || '').trim();
            if (explicitLabel) {
                return explicitLabel;
            }
            const reasons = Array.isArray(risk.reasons) ? risk.reasons : [];
            if (Number(risk.missing_cost_item_count || 0) > 0 || reasons.some((reason) => reason?.type === 'missing_cost')) {
                return '采购成本待补齐';
            }
            if (String(risk.cost_coverage || '').trim().toLowerCase() === 'no_inventory' || reasons.some((reason) => reason?.type === 'no_inventory')) {
                return '库存关联待补齐';
            }
            if (Number(risk.untracked_revenue_points || 0) > 0 || reasons.some((reason) => reason?.type === 'point_source_gap')) {
                return '积分来源待补齐';
            }
            risk = risk.severity || risk.tone || '';
        }

        const normalized = String(risk || '').trim().toLowerCase();
        if (normalized === 'critical') return '高风险';
        if (normalized === 'warning') return '归因信息待补齐';
        if (normalized === 'review') return '需复核';
        return '正常';
    }

    function renderShopProfitOrderRiskList(summary = {}) {
        const riskList = normalizePaymentsContextObject(summary.order_risk_list);
        const items = Array.isArray(riskList.items) ? riskList.items.filter(Boolean).slice(0, 8) : [];
        if (!items.length) return '';

        return `
            <div class="payments-shop-profit-audit__orders" aria-label="商城利润风险订单">
                <div class="payments-shop-profit-audit__orders-head">
                    <strong>风险订单</strong>
                    <span>负利润、缺成本、未关联库存和积分来源缺口按优先级展示</span>
                </div>
                <div class="payments-shop-profit-audit__order-list">
                    ${items.map((item) => {
                        const tone = normalizeShopProfitIssueTone(item.tone || item.severity);
                        const reasons = Array.isArray(item.reasons) ? item.reasons.filter(Boolean).slice(0, 4) : [];
                        const orderId = String(item.order_id || '').trim();
                        const orderLabel = String(item.order_no || item.order_id || '未知订单').trim() || '未知订单';
                        const productLabel = String(item.product_name || '未命名商品').trim() || '未命名商品';
                        const detailParts = [
                            item.created_at ? formatDateTime(item.created_at) : '',
                            `收入 ${formatCurrency(item.recognized_revenue_cny)}`,
                            `成本 ${formatCurrency(item.recognized_cost_cny)}`,
                            Number(item.untracked_revenue_points || 0) > 0 ? `未追踪 ${formatPrecisePoints(item.untracked_revenue_points)} 积分` : '',
                            Number(item.bonus_points_spent || 0) > 0 ? `非现金 ${formatPrecisePoints(item.bonus_points_spent)} 积分` : '',
                            item.point_source_traceability_label ? `来源 ${item.point_source_traceability_label}` : ''
                        ].filter(Boolean);

                        return `
                            <div class="payments-shop-profit-audit__order is-${escapeHtml(tone)}">
                                <div class="payments-shop-profit-audit__order-main">
                                    <div>
                                        ${orderId ? `
                                            <button
                                                type="button"
                                                class="payments-shop-profit-audit__order-link"
                                                data-admin-action="payments-open-shop-order"
                                                data-shop-order-id="${escapeHtml(encodeURIComponent(orderId))}"
                                                title="点击查看商城订单详情"
                                                aria-label="查看商城订单 ${escapeHtml(orderLabel)}"
                                            >${escapeHtml(orderLabel)}</button>
                                        ` : `<strong>${escapeHtml(orderLabel)}</strong>`}
                                        <span>${escapeHtml(`${productLabel} · 点击订单号查看订单详情`)}</span>
                                    </div>
                                    <em>${escapeHtml(formatCurrency(item.net_profit_cny))}</em>
                                </div>
                                <div class="payments-shop-profit-audit__order-meta">
                                    <span>${escapeHtml(getShopProfitOrderRiskStatusLabel(item))}</span>
                                    ${reasons.map((reason) => `<span>${escapeHtml(reason.label || reason.type || '风险项')}</span>`).join('')}
                                </div>
                                <div class="payments-shop-profit-audit__order-detail">
                                    <span>${escapeHtml(detailParts.join(' · '))}</span>
                                    <strong>${escapeHtml(item.action_label || '复核订单利润归因')}</strong>
                                </div>
                                ${renderShopProfitResolutionPlan(item.resolution_plan)}
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    function renderShopProfitDimensionRows(rows = [], options = {}) {
        const safeRows = Array.isArray(rows) ? rows.filter(Boolean).slice(0, 4) : [];
        const emptyText = options.emptyText || '暂无可归因数据';
        if (!safeRows.length) {
            return `<div class="payments-shop-profit-audit__dimension-empty">${escapeHtml(emptyText)}</div>`;
        }

        return safeRows.map((row) => {
            const tone = normalizeShopProfitIssueTone(row.risk_tone);
            const marginRate = row.margin_rate === null || row.margin_rate === undefined
                ? '—'
                : formatRatioPercent(row.margin_rate);
            const coverageRate = formatRatioPercent(row.cost_coverage_rate || 0);
            const metaParts = [
                `${formatNumber(row.order_count || 0)} 笔`,
                `收入 ${formatCurrency(row.recognized_revenue_cny)}`,
                `成本 ${formatCurrency(row.recognized_cost_cny)}`
            ];
            const riskParts = [
                Number(row.negative_profit_order_count || 0) > 0 ? `负利 ${formatNumber(row.negative_profit_order_count)} 笔` : '',
                Number(row.missing_cost_item_count || 0) > 0 ? `缺成本 ${formatNumber(row.missing_cost_item_count)} 件` : '',
                Number(row.no_inventory_order_count || 0) > 0 ? `未关联 ${formatNumber(row.no_inventory_order_count)} 笔` : '',
                Number(row.refunded_order_count || 0) > 0 ? `退款 ${formatNumber(row.refunded_order_count)} 笔` : ''
            ].filter(Boolean);

            return `
                <div class="payments-shop-profit-audit__dimension-row is-${escapeHtml(tone)}">
                    <div class="payments-shop-profit-audit__dimension-main">
                        <div>
                            <strong>${escapeHtml(row.label || '未命名')}</strong>
                            <span>${escapeHtml(metaParts.join(' · '))}</span>
                        </div>
                        <em>${escapeHtml(formatCurrency(row.net_profit_cny))}</em>
                    </div>
                    <div class="payments-shop-profit-audit__dimension-meta">
                        <span>毛利 ${escapeHtml(marginRate)}</span>
                        <span>覆盖 ${escapeHtml(coverageRate)}</span>
                        ${riskParts.map((part) => `<span>${escapeHtml(part)}</span>`).join('')}
                    </div>
                </div>
            `;
        }).join('');
    }

    function renderShopProfitDimensionBreakdown(summary = {}) {
        const breakdown = normalizePaymentsContextObject(summary.dimension_breakdown);
        const products = Array.isArray(breakdown.products) ? breakdown.products : [];
        const skus = Array.isArray(breakdown.skus) ? breakdown.skus : [];
        const sourceBatches = Array.isArray(breakdown.source_batches) ? breakdown.source_batches : [];
        const sources = Array.isArray(breakdown.sources) ? breakdown.sources : [];
        if (!products.length && !skus.length && !sourceBatches.length && !sources.length) return '';

        return `
            <div class="payments-shop-profit-audit__dimensions" aria-label="商城利润维度分析">
                <div class="payments-shop-profit-audit__dimensions-head">
                    <strong>利润维度</strong>
                    <span>按风险优先展示商品、规格、货源与采购批次</span>
                </div>
                <div class="payments-shop-profit-audit__dimension-grid">
                    <section class="payments-shop-profit-audit__dimension-panel">
                        <div class="payments-shop-profit-audit__dimension-title">商品利润</div>
                        ${renderShopProfitDimensionRows(products, { emptyText: '暂无商品利润归因' })}
                    </section>
                    <section class="payments-shop-profit-audit__dimension-panel">
                        <div class="payments-shop-profit-audit__dimension-title">规格利润</div>
                        ${renderShopProfitDimensionRows(skus, { emptyText: '暂无规格利润归因' })}
                    </section>
                    <section class="payments-shop-profit-audit__dimension-panel">
                        <div class="payments-shop-profit-audit__dimension-title">批次利润</div>
                        ${renderShopProfitDimensionRows(sourceBatches, { emptyText: '暂无批次利润归因' })}
                    </section>
                    <section class="payments-shop-profit-audit__dimension-panel">
                        <div class="payments-shop-profit-audit__dimension-title">货源利润</div>
                        ${renderShopProfitSourceRows(sources)}
                    </section>
                </div>
            </div>
        `;
    }

    function renderShopProfitSourceRows(rows = []) {
        const safeRows = Array.isArray(rows) ? rows.filter(Boolean).slice(0, 4) : [];
        if (!safeRows.length) {
            return '<div class="payments-shop-profit-audit__dimension-empty">暂无货源利润归因</div>';
        }

        return safeRows.map((row) => {
            const tone = normalizeShopProfitIssueTone(row.risk_tone);
            const metaParts = [
                `${formatNumber(row.order_count || 0)} 笔`,
                row.source_platform ? `平台 ${row.source_platform}` : '',
                row.source_risk_tier ? `风险 ${row.source_risk_tier}` : '',
                row.source_quality_grade ? `质量 ${row.source_quality_grade}` : ''
            ].filter(Boolean);
            const riskParts = [
                Number(row.negative_profit_order_count || 0) > 0 ? `负利 ${formatNumber(row.negative_profit_order_count)} 笔` : '',
                Number(row.missing_cost_order_count || 0) > 0 ? `缺成本 ${formatNumber(row.missing_cost_order_count)} 笔` : '',
                row.procurement_suggestion || ''
            ].filter(Boolean);

            return `
                <div class="payments-shop-profit-audit__dimension-row is-${escapeHtml(tone)}">
                    <div class="payments-shop-profit-audit__dimension-main">
                        <div>
                            <strong>${escapeHtml(row.source_name || row.label || '未归因货源')}</strong>
                            <span>${escapeHtml(metaParts.join(' · '))}</span>
                        </div>
                        <em>${escapeHtml(formatCurrency(row.net_profit_cny))}</em>
                    </div>
                    <div class="payments-shop-profit-audit__dimension-meta">
                        <span>覆盖 ${escapeHtml(formatRatioPercent(row.cost_coverage_rate || 0))}</span>
                        ${riskParts.map((part) => `<span>${escapeHtml(part)}</span>`).join('')}
                    </div>
                </div>
            `;
        }).join('');
    }

    function getShopProcurementRecommendationActionLabel(actionType = '') {
        const normalized = String(actionType || '').trim().toLowerCase();
        if (normalized === 'pause_reorder') return '暂停复采';
        if (normalized === 'complete_cost') return '补齐成本';
        if (normalized === 'reorder_candidate') return '优先复采';
        return '继续观察';
    }

    function renderShopSourceProcurementRecommendations(summary = {}) {
        const recommendations = normalizePaymentsContextObject(summary.source_procurement_recommendations);
        const items = Array.isArray(recommendations.items) ? recommendations.items.filter(Boolean).slice(0, 8) : [];
        if (!items.length) return '';

        const status = String(recommendations.status || '').trim().toLowerCase();
        const tone = normalizeShopProfitIssueTone(status === 'ready' ? 'ready' : status);
        const statusLabel = status === 'critical'
            ? '存在暂停复采项'
            : (status === 'warning' ? '存在待补齐项' : '采购建议已生成');

        return `
            <div class="payments-shop-profit-audit__procurement" aria-label="商城货源采购建议">
                <div class="payments-shop-profit-audit__procurement-head">
                    <div>
                        <strong>采购建议</strong>
                        <span>按货源净利润、成本覆盖、退款和负利润表现生成复采动作</span>
                    </div>
                    <em class="is-${escapeHtml(tone)}">${escapeHtml(statusLabel)} · ${escapeHtml(formatNumber(recommendations.action_required_count || 0))} 项待处理</em>
                </div>
                <div class="payments-shop-profit-audit__procurement-list">
                    ${items.map((item) => {
                        const itemTone = normalizeShopProfitIssueTone(item.severity);
                        const metaParts = [
                            `${formatNumber(item.order_count || 0)} 笔订单`,
                            item.source_platform ? `平台 ${item.source_platform}` : '',
                            item.source_risk_tier ? `风险 ${item.source_risk_tier}` : '',
                            item.source_quality_grade ? `质量 ${item.source_quality_grade}` : ''
                        ].filter(Boolean);
                        const metricParts = [
                            `净利 ${formatCurrency(item.net_profit_cny)}`,
                            `毛利 ${item.margin_rate === null || item.margin_rate === undefined ? '—' : formatRatioPercent(item.margin_rate)}`,
                            `覆盖 ${formatRatioPercent(item.cost_coverage_rate || 0)}`,
                            Number(item.refunded_order_count || 0) > 0 ? `退款 ${formatNumber(item.refunded_order_count)} 笔` : '',
                            Number(item.negative_profit_order_count || 0) > 0 ? `负利 ${formatNumber(item.negative_profit_order_count)} 笔` : '',
                            Number(item.missing_cost_order_count || 0) > 0 ? `缺成本 ${formatNumber(item.missing_cost_order_count)} 笔` : ''
                        ].filter(Boolean);

                        return `
                            <div class="payments-shop-profit-audit__procurement-item is-${escapeHtml(itemTone)}">
                                <div class="payments-shop-profit-audit__procurement-main">
                                    <div>
                                        <strong>${escapeHtml(item.source_name || '未归因货源')}</strong>
                                        <span>${escapeHtml(metaParts.join(' · '))}</span>
                                    </div>
                                    <em>${escapeHtml(getShopProcurementRecommendationActionLabel(item.action_type))}</em>
                                </div>
                                <div class="payments-shop-profit-audit__procurement-meta">
                                    <span>${escapeHtml(item.reason_label || '表现待观察')}</span>
                                    ${metricParts.map((part) => `<span>${escapeHtml(part)}</span>`).join('')}
                                </div>
                                <div class="payments-shop-profit-audit__procurement-action">${escapeHtml(item.action_label || '继续观察货源表现')}</div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    function getShopProfitAdjustmentStatusLabel(status) {
        const normalized = String(status || '').trim().toLowerCase();
        if (normalized === 'review_required' || normalized === 'review') return '需复核';
        if (normalized === 'tracked_income_deduction') return '收入端扣减';
        if (normalized === 'tracked_revenue_exclusion') return '已剔除';
        if (normalized === 'tracked_reversal') return '已冲销';
        if (normalized === 'tracked') return '已追踪';
        return '待接入';
    }

    function getShopProfitAdjustmentClosureLabel(status = '') {
        const normalized = String(status || '').trim().toLowerCase();
        if (normalized === 'review') return '需复核';
        if (normalized === 'excluded') return '已剔除';
        if (normalized === 'extension') return '预留扩展';
        return '已纳入';
    }

    function renderShopProfitAdjustments(summary = {}) {
        const adjustments = normalizePaymentsContextObject(summary.profit_adjustments);
        const items = Array.isArray(adjustments.items) ? adjustments.items.filter(Boolean).slice(0, 5) : [];
        const breakdown = normalizePaymentsContextObject(summary.profit_adjustment_breakdown);
        const breakdownItems = Array.isArray(breakdown.items) ? breakdown.items.filter(Boolean).slice(0, 8) : [];
        if (!items.length && !breakdownItems.length) return '';

        return `
            <div class="payments-shop-profit-audit__adjustments" aria-label="商城利润调整项">
                <div class="payments-shop-profit-audit__adjustments-head">
                    <strong>利润调整项</strong>
                    <span>优惠、赠送积分和退款影响先独立展示，分录化后可进入完整净利润口径</span>
                </div>
                ${items.length ? `<div class="payments-shop-profit-audit__adjustment-list">
                    ${items.map((item) => {
                        const tone = normalizeShopProfitIssueTone(item.tone);
                        const statusLabel = getShopProfitAdjustmentStatusLabel(item.status);
                        const detailParts = [
                            `${formatNumber(item.order_count || 0)} 笔订单`,
                            Number(item.points || 0) > 0 ? `${formatPrecisePoints(item.points)} 积分` : '',
                            statusLabel
                        ].filter(Boolean);

                        return `
                            <div class="payments-shop-profit-audit__adjustment is-${escapeHtml(tone)}">
                                <div class="payments-shop-profit-audit__adjustment-main">
                                    <div>
                                        <strong>${escapeHtml(item.title || '利润影响项')}</strong>
                                        <span>${escapeHtml(item.treatment || item.description || '等待后续分录化归因。')}</span>
                                    </div>
                                    <em>${escapeHtml(formatCurrency(item.amount_cny))}</em>
                                </div>
                                <div class="payments-shop-profit-audit__adjustment-meta">
                                    ${detailParts.map((part) => `<span>${escapeHtml(part)}</span>`).join('')}
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>` : ''}
                ${breakdownItems.length ? `
                    <div class="payments-shop-profit-audit__adjustment-breakdown">
                        ${breakdownItems.map((item) => {
                            const tone = normalizeShopProfitIssueTone(item.tone);
                            const metaParts = [
                                getShopProfitAdjustmentClosureLabel(item.closure_status),
                                Number(item.order_count || 0) > 0 ? `${formatNumber(item.order_count)} 笔订单` : '',
                                Number(item.points || 0) > 0 ? `${formatPrecisePoints(item.points)} 积分` : '',
                                Number(item.amount_cny || 0) > 0 ? formatCurrency(item.amount_cny) : ''
                            ].filter(Boolean);

                            return `
                                <div class="payments-shop-profit-audit__adjustment-breakdown-row is-${escapeHtml(tone)}">
                                    <div>
                                        <strong>${escapeHtml(item.label || item.title || '利润影响项')}</strong>
                                        <span>${escapeHtml(item.net_profit_treatment || '已纳入利润影响项观察。')}</span>
                                    </div>
                                    <em>${escapeHtml(metaParts.join(' · '))}</em>
                                </div>
                            `;
                        }).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    }

    function formatShopProfitLedgerAmount(entry = {}) {
        const type = String(entry.type || entry.entry_type || '').trim().toLowerCase();
        const status = String(entry.status || '').trim().toLowerCase();
        const amount = Number(entry.amount_cny || 0);

        if (type === 'inventory_cost_missing' || status === 'incomplete') {
            return '待补成本';
        }
        return formatCurrency(amount);
    }

    function getShopProfitLedgerStatusLabel(status) {
        const normalized = String(status || '').trim().toLowerCase();
        if (normalized === 'balanced') return '已平衡';
        if (normalized === 'estimated') return '含估算';
        if (normalized === 'incomplete') return '待补齐';
        if (normalized === 'settled') return '已结算';
        if (normalized === 'reversed' || normalized === 'reversed_estimated') return '已冲销';
        if (normalized === 'excluded') return '已剔除';
        if (normalized === 'tracked_income_deduction') return '收入端扣减';
        return '未生成';
    }

    function renderShopProfitLedgerPreview(summary = {}) {
        const preview = normalizePaymentsContextObject(summary.profit_ledger_preview);
        const entries = Array.isArray(preview.entries_by_type) ? preview.entries_by_type.filter(Boolean).slice(0, 6) : [];
        if (!entries.length) return '';

        const status = String(preview.status || '').trim().toLowerCase();
        const tone = status === 'incomplete' || status === 'estimated' ? 'warning' : 'ready';
        const statusLabel = getShopProfitLedgerStatusLabel(status);

        return `
            <div class="payments-shop-profit-audit__ledger" aria-label="商城利润分录预览">
                <div class="payments-shop-profit-audit__ledger-head">
                    <div>
                        <strong>分录预览</strong>
                        <span>按当前订单归因生成，可迁移到 shop_order_profit_ledger 持久化</span>
                    </div>
                    <em class="is-${escapeHtml(tone)}">${escapeHtml(statusLabel)}</em>
                </div>
                <div class="payments-shop-profit-audit__ledger-metrics">
                    <div><span>分录合计</span><strong>${escapeHtml(formatCurrency(preview.net_amount_cny))}</strong></div>
                    <div><span>收入分录</span><strong>${escapeHtml(formatCurrency(preview.revenue_amount_cny))}</strong></div>
                    <div><span>成本分录</span><strong>${escapeHtml(formatCurrency(preview.cost_amount_cny))}</strong></div>
                    <div><span>分录数量</span><strong>${escapeHtml(formatNumber(preview.entry_count || 0))}</strong></div>
                </div>
                <div class="payments-shop-profit-audit__ledger-list">
                    ${entries.map((entry) => {
                        const entryTone = normalizeShopProfitIssueTone(entry.tone);
                        const detailParts = [
                            `${formatNumber(entry.entry_count || 0)} 条`,
                            `${formatNumber(entry.order_count || 0)} 笔订单`,
                            Number(entry.points_amount || 0) > 0 ? `${formatPrecisePoints(entry.points_amount)} 积分` : ''
                        ].filter(Boolean);

                        return `
                            <div class="payments-shop-profit-audit__ledger-row is-${escapeHtml(entryTone)}">
                                <div>
                                    <strong>${escapeHtml(entry.title || entry.type || '分录')}</strong>
                                    <span>${escapeHtml(detailParts.join(' · '))}</span>
                                </div>
                                <em>${escapeHtml(formatShopProfitLedgerAmount(entry))}</em>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    function renderShopProfitAudit(data) {
        const summary = getShopProfitSummary(data);
        if (!hasShopProfitAuditSummary(summary)) {
            return '';
        }

        const costBreakdown = normalizePaymentsContextObject(summary.cost_coverage_breakdown);
        const reconciliationIssues = Array.isArray(summary.reconciliation_issues)
            ? summary.reconciliation_issues.filter(Boolean)
            : [];
        const pointSourceCoverage = normalizePaymentsContextObject(summary.point_source_coverage);
        const notes = Array.isArray(summary.notes) ? summary.notes.filter(Boolean).slice(0, 4) : [];
        const marginRate = summary.margin_rate === null || summary.margin_rate === undefined
            ? '—'
            : formatRatioPercent(summary.margin_rate);
        const coverageRate = formatRatioPercent(summary.cost_coverage_rate || 0);
        const pointLotCoverageRate = formatRatioPercent(pointSourceCoverage.coverage_rate || 0);
        const missingCostCount = Number(summary.missing_cost_item_count || 0);
        const untrackedPoints = Number(summary.untracked_revenue_points || 0);
        const bonusPoints = Number(summary.bonus_points_spent || 0);
        const pointSourceLabel = String(pointSourceCoverage.label || '').trim() || '未追踪';
        const sourceBreakdownMain = Number(pointSourceCoverage.order_count || 0) > 0
            ? `${pointSourceLabel} ${pointLotCoverageRate}`
            : (untrackedPoints > 0
                ? `未拆分 ${formatPrecisePoints(untrackedPoints)}`
                : (bonusPoints > 0 ? `奖励 ${formatPrecisePoints(bonusPoints)}` : '已拆分'));
        const sourceBreakdownHint = Number(pointSourceCoverage.action_required_order_count || 0) > 0
            ? `待复核 ${formatNumber(pointSourceCoverage.action_required_order_count)} 笔 / 未追踪 ${formatPrecisePoints(pointSourceCoverage.untracked_points)} 积分`
            : (Number(pointSourceCoverage.migration_points || 0) > 0
                ? `迁移期余额 ${formatPrecisePoints(pointSourceCoverage.migration_points)} 积分已纳入批次追踪`
                : (untrackedPoints > 0
                    ? `奖励 ${formatPrecisePoints(bonusPoints)} / 未拆分积分暂按旧口径估算收入`
                    : (bonusPoints > 0 ? '奖励/赠送积分不确认为现金收入' : '付费/奖励积分来源完整')));
        const reconciliationStatus = String(summary.reconciliation_status || '').trim().toLowerCase();
        const statusTone = reconciliationStatus === 'critical'
            ? 'critical'
            : (reconciliationIssues.length || missingCostCount > 0 || untrackedPoints > 0 ? 'warning' : 'ready');
        const statusLabel = reconciliationIssues.length
            ? `闭环项 ${formatNumber(summary.reconciliation_issue_count || reconciliationIssues.length)} 类`
            : (missingCostCount > 0
                ? `缺成本 ${formatNumber(missingCostCount)} 件`
                : (untrackedPoints > 0 ? `历史未拆分 ${formatPrecisePoints(untrackedPoints)} 积分` : '口径完整'));

        return `
            <section class="payments-shop-profit-audit" aria-label="商城净利润审计">
                <div class="payments-shop-profit-audit__head">
                    <div class="payments-shop-profit-audit__title">
                        <span class="payments-shop-profit-audit__icon"><i class="fas fa-scale-balanced"></i></span>
                        <div>
                            <strong>商城净利润审计</strong>
                            <span>现金收入、采购成本与积分来源拆分</span>
                        </div>
                    </div>
                    <span class="payments-shop-profit-audit__status is-${escapeHtml(statusTone)}">${escapeHtml(statusLabel)}</span>
                </div>
                <div class="payments-shop-profit-audit__metrics">
                    <div>
                        <span>现金确认收入</span>
                        <strong>${escapeHtml(formatCurrency(summary.recognized_revenue_cny))}</strong>
                        <em>付费积分 ${escapeHtml(formatPrecisePoints(summary.paid_points_spent))}</em>
                    </div>
                    <div>
                        <span>确认采购成本</span>
                        <strong>${escapeHtml(formatCurrency(summary.recognized_cost_cny))}</strong>
                        <em>覆盖率 ${escapeHtml(coverageRate)}</em>
                    </div>
                    <div>
                        <span>净利润</span>
                        <strong>${escapeHtml(formatCurrency(summary.net_profit_cny))}</strong>
                        <em>毛利率 ${escapeHtml(marginRate)}</em>
                    </div>
                    <div>
                        <span>积分来源拆分</span>
                        <strong>${escapeHtml(sourceBreakdownMain)}</strong>
                        <em>${escapeHtml(sourceBreakdownHint)}</em>
                    </div>
                </div>
                <div class="payments-shop-profit-audit__split">
                    <span>订单 ${escapeHtml(formatNumber(summary.order_count))} 笔</span>
                    <span>退款 ${escapeHtml(formatNumber(summary.refunded_order_count))} 笔</span>
                    <span>库存 ${escapeHtml(formatNumber(summary.inventory_item_count))} 件</span>
                    <span>已成本化 ${escapeHtml(formatNumber(summary.costed_item_count))} 件</span>
                    <span>成本完整订单 ${escapeHtml(formatNumber(costBreakdown.complete || 0))}</span>
                    <span>部分缺成本订单 ${escapeHtml(formatNumber(costBreakdown.partial || 0))}</span>
                    <span>无成本订单 ${escapeHtml(formatNumber(costBreakdown.no_cost || 0))}</span>
                    <span>未关联库存订单 ${escapeHtml(formatNumber(costBreakdown.no_inventory || 0))}</span>
                    <span>积分批次覆盖 ${escapeHtml(pointLotCoverageRate)}</span>
                    <span>批次完整订单 ${escapeHtml(formatNumber(pointSourceCoverage.exact_order_count || 0))}</span>
                    <span>迁移期余额 ${escapeHtml(formatPrecisePoints(pointSourceCoverage.migration_points || 0))}</span>
                    <span>待追踪积分 ${escapeHtml(formatPrecisePoints(pointSourceCoverage.untracked_points || 0))}</span>
                </div>
                ${notes.length ? `
                    <div class="payments-shop-profit-audit__notes">
                        ${notes.map((note) => `<span>${escapeHtml(note)}</span>`).join('')}
                    </div>
                ` : ''}
                ${renderShopProfitReadiness(summary)}
                ${renderShopProfitAdjustments(summary)}
                ${renderShopProfitLedgerPreview(summary)}
                ${renderShopProfitDimensionBreakdown(summary)}
                ${renderShopSourceProcurementRecommendations(summary)}
                ${renderShopProfitReconciliationClosure(summary)}
                ${renderShopProfitHistoricalDisposition(summary)}
                ${renderShopProfitOrderRiskList(summary)}
                ${renderShopProfitAuditAlerts(summary)}
                ${renderShopProfitReconciliationIssues(reconciliationIssues)}
            </section>
        `;
    }

    function syncBusinessBreakdownInteractiveState(target, model, items) {
        if (!target || !model?.labels?.length) return;

        const activeIndex = getBusinessBreakdownActiveIndex(model);
        const focusKey = getResolvedBusinessBreakdownFocusKey(items);
        const guideX = model.xPositions[activeIndex]?.x ?? model.chartLeft;
        const inspector = target.querySelector('[data-payments-business-inspector]');
        if (inspector) {
            inspector.innerHTML = renderBusinessBreakdownInspector(model, items);
        }

        const guide = target.querySelector('[data-payments-business-guide]');
        if (guide) {
            guide.setAttribute('x1', guideX);
            guide.setAttribute('x2', guideX);
        }

        target.querySelectorAll('[data-payments-business-point-index]').forEach((pointNode) => {
            const pointIndex = Number(pointNode.dataset.paymentsBusinessPointIndex || -1);
            const pointKey = String(pointNode.dataset.paymentsBusinessPointKey || '').trim().toLowerCase();
            const isActive = pointIndex === activeIndex;
            const isMuted = focusKey !== 'all' && pointKey !== focusKey;
            const isFocused = focusKey !== 'all' && pointKey === focusKey;
            pointNode.classList.toggle('is-active', isActive);
            pointNode.classList.toggle('is-muted', isMuted);
            pointNode.classList.toggle('is-focused', isFocused);
        });

        target.querySelectorAll('[data-payments-business-index]').forEach((hitareaNode) => {
            const hitareaIndex = Number(hitareaNode.dataset.paymentsBusinessIndex || -1);
            hitareaNode.classList.toggle('is-active', hitareaIndex === activeIndex);
        });

        target.querySelectorAll('[data-payments-business-series-key]').forEach((seriesNode) => {
            const seriesKey = String(seriesNode.dataset.paymentsBusinessSeriesKey || '').trim().toLowerCase();
            seriesNode.classList.toggle('is-focused', focusKey !== 'all' && focusKey === seriesKey);
            seriesNode.classList.toggle('is-muted', focusKey !== 'all' && focusKey !== seriesKey);
        });

        target.querySelectorAll('[data-payments-business-focus-key]').forEach((focusNode) => {
            const nodeKey = String(focusNode.dataset.paymentsBusinessFocusKey || '').trim().toLowerCase() || 'all';
            const isActive = nodeKey === focusKey;
            const isMuted = focusKey !== 'all' && nodeKey !== 'all' && !isActive;
            focusNode.classList.toggle('is-active', isActive);
            focusNode.classList.toggle('is-muted', isMuted);
            focusNode.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });

        target.querySelectorAll('[data-payments-business-row-key]').forEach((rowNode) => {
            const rowKey = String(rowNode.dataset.paymentsBusinessRowKey || '').trim().toLowerCase();
            rowNode.classList.toggle('is-focused', focusKey === rowKey);
            rowNode.classList.toggle('is-muted', focusKey !== 'all' && focusKey !== rowKey);
        });
    }

    function setBusinessBreakdownFocusKey(focusKey = 'all') {
        const normalizedFocusKey = String(focusKey || 'all').trim().toLowerCase() || 'all';
        state.businessBreakdownFocusKey = normalizedFocusKey === state.businessBreakdownFocusKey && normalizedFocusKey !== 'all'
            ? 'all'
            : normalizedFocusKey;
        state.businessBreakdownHoverIndex = null;
        renderBusinessBreakdown(state.summary || {});
    }

    function bindBusinessBreakdownInteractions(target, model, items) {
        if (!target) return;

        if (!target.dataset.paymentsBusinessFocusBound) {
            target.addEventListener('click', (event) => {
                const focusButton = event.target.closest('[data-payments-business-focus-key]');
                if (!focusButton || !target.contains(focusButton)) return;
                setBusinessBreakdownFocusKey(focusButton.dataset.paymentsBusinessFocusKey || 'all');
            });
            target.dataset.paymentsBusinessFocusBound = 'true';
        }

        target.querySelectorAll('[data-payments-business-index]').forEach((hitarea) => {
            const nextIndex = Number(hitarea.dataset.paymentsBusinessIndex || -1);
            if (!Number.isInteger(nextIndex) || nextIndex < 0) return;

            hitarea.addEventListener('mouseenter', () => {
                state.businessBreakdownHoverIndex = nextIndex;
                syncBusinessBreakdownInteractiveState(target, model, items);
            });
            hitarea.addEventListener('focus', () => {
                state.businessBreakdownHoverIndex = nextIndex;
                syncBusinessBreakdownInteractiveState(target, model, items);
            });
        });

        const chartShell = target.querySelector('.payments-business-trend-plot-shell');
        if (chartShell) {
            chartShell.addEventListener('mouseleave', () => {
                state.businessBreakdownHoverIndex = null;
                syncBusinessBreakdownInteractiveState(target, model, items);
            });
        }
    }

    function renderBusinessBreakdown(data) {
        const target = document.getElementById('paymentsBusinessBreakdown');
        if (!target) return;
        const items = buildBusinessBreakdownItems(data);

        if (!items.length) {
            target.innerHTML = '<div class="payments-empty-state">当前暂无全站业务收支数据。</div>';
            return;
        }

        const model = buildBusinessBreakdownChartModel(items);
        target.innerHTML = `
            <div class="payments-business-board">
                ${renderShopProfitAudit(data)}
                ${renderBusinessBreakdownChartPanel(model, items)}
                ${renderBusinessBreakdownTable(items)}
            </div>
        `;

        bindBusinessBreakdownInteractions(target, model, items);
        syncBusinessBreakdownInteractiveState(target, model, items);
    }

    function getPointsBreakdownKey(item) {
        return String(item?.key || '').trim().toLowerCase();
    }

    function getPointsBreakdownToneMeta(itemOrKey) {
        const key = typeof itemOrKey === 'string'
            ? String(itemOrKey || '').trim().toLowerCase()
            : getPointsBreakdownKey(itemOrKey);
        return POINTS_BREAKDOWN_TONE_META[key] || POINTS_BREAKDOWN_TONE_META.all;
    }

    function getPointsBreakdownTrendPoints(item) {
        return Array.isArray(item?.trend)
            ? item.trend
                .filter((point) => point && typeof point === 'object')
                .map((point) => ({
                    label: String(point.label || '').trim(),
                    value: Number(point.value || 0)
                }))
                .filter((point) => Number.isFinite(point.value))
            : [];
    }

    function buildPointsBreakdownItems(data) {
        const items = Array.isArray(data?.points_breakdown) ? data.points_breakdown : [];
        return items.map((item, index) => {
            const key = getPointsBreakdownKey(item) || `points-${index + 1}`;
            const trend = getPointsBreakdownTrendPoints(item);
            const values = trend.map((point) => Number(point.value || 0));
            const latest = values.length ? values[values.length - 1] : Number(item.net || 0);
            const previous = values.length > 1 ? values[values.length - 2] : latest;
            const average = values.length ? (values.reduce((sum, value) => sum + value, 0) / values.length) : Number(item.net || 0);
            const peak = values.length
                ? values.reduce((winner, value) => (Math.abs(value) > Math.abs(winner) ? value : winner), values[0])
                : Number(item.net || 0);

            return {
                ...item,
                key,
                title: item.label || item.key || '积分分类',
                description: `流入 ${formatPoints(item.inflow)} · 流出 ${formatPoints(item.outflow)}`,
                metric: formatSignedPoints(item.net),
                meta: Number(item.net || 0) >= 0 ? '净流入' : '净流出',
                metricKind: 'points',
                trend,
                latest,
                latestLabel: trend[trend.length - 1]?.label || '当前',
                average,
                peak,
                delta: latest - previous
            };
        });
    }

    function getResolvedPointsBreakdownFocusKey(items) {
        const keys = new Set((items || []).map((item) => item.key));
        if (keys.has(state.pointsBreakdownFocusKey)) {
            return state.pointsBreakdownFocusKey;
        }
        return 'all';
    }

    function buildPointsBreakdownChartModel(items) {
        const labels = buildBusinessBreakdownLabels(items);
        const focusKey = getResolvedPointsBreakdownFocusKey(items);
        const mode = 'normalized';
        const chartItems = items;
        const focusedItem = focusKey === 'all'
            ? null
            : items.find((item) => item.key === focusKey) || null;
        const width = 1040;
        const height = 340;
        const chartLeft = 66;
        const chartRight = 24;
        const chartTop = 24;
        const chartBottom = 40;
        const plotWidth = Math.max(0, width - chartLeft - chartRight);
        const plotHeight = Math.max(0, height - chartTop - chartBottom);
        const xPositions = labels.map((label, index) => {
            const x = labels.length === 1
                ? chartLeft + (plotWidth / 2)
                : chartLeft + ((plotWidth * index) / Math.max(1, labels.length - 1));
            return {
                label,
                index,
                x: Number(x.toFixed(2))
            };
        });
        const xTickIndexes = buildBusinessBreakdownTickIndexes(labels.length, 6);
        const series = chartItems.map((item) => {
            const meta = getPointsBreakdownToneMeta(item);
            const values = getBusinessBreakdownSeriesValues(item, labels);
            const minValue = values.length ? Math.min(...values) : 0;
            const maxValue = values.length ? Math.max(...values) : 0;
            const rawRange = maxValue - minValue;
            const pad = rawRange > 0
                ? rawRange * 0.1
                : Math.max(1, Math.abs(maxValue) * 0.1 || 1);
            const scaleMin = minValue - pad;
            const scaleMax = maxValue + pad;
            const scaleRange = Math.max(scaleMax - scaleMin, 1);
            const points = values.map((value, index) => {
                const ratio = (value - scaleMin) / scaleRange;
                const y = chartTop + plotHeight - (ratio * plotHeight);
                return {
                    index,
                    label: labels[index] || '',
                    value,
                    x: xPositions[index]?.x ?? chartLeft,
                    y: Number(y.toFixed(2))
                };
            });
            const linePath = buildBusinessBreakdownSmoothPath(points);
            const areaPath = points.length
                ? `${linePath} L ${points[points.length - 1].x} ${chartTop + plotHeight} L ${points[0].x} ${chartTop + plotHeight} Z`
                : '';

            return {
                ...item,
                meta,
                values,
                scaleMin,
                scaleMax,
                isFocused: focusKey !== 'all' && item.key === focusKey,
                isMuted: focusKey !== 'all' && item.key !== focusKey,
                showArea: focusKey !== 'all' && item.key === focusKey,
                points,
                linePath,
                areaPath
            };
        });
        const yTicks = [100, 75, 50, 25, 0].map((value, index) => ({
            label: `${value}%`,
            y: Number((chartTop + (plotHeight * (index / 4))).toFixed(2))
        }));

        return {
            focusKey,
            mode,
            focusedItem,
            labels,
            series,
            width,
            height,
            chartLeft,
            chartRight,
            chartTop,
            chartBottom,
            plotWidth,
            plotHeight,
            xPositions,
            xTickIndexes,
            yTicks,
            rangeLabel: labels.length ? `最近 ${labels.length} 个观察日` : '暂无观察日',
            modeLabel: focusedItem ? `聚焦 ${focusedItem.title || '积分分类'}` : '多序列对比',
            note: focusedItem
                ? `已聚焦 ${focusedItem.title || '当前分类'}，其它曲线保留走势并淡化显示。`
                : '当前为多分类对比模式，各曲线按自身区间缩放，便于观察分类节奏。'
        };
    }

    function getPointsBreakdownActiveIndex(model) {
        if (!model?.labels?.length) return -1;
        const index = Number(state.pointsBreakdownHoverIndex);
        if (Number.isInteger(index) && index >= 0 && index < model.labels.length) {
            return index;
        }
        return model.labels.length - 1;
    }

    function renderPointsBreakdownLegend(items) {
        const focusKey = getResolvedPointsBreakdownFocusKey(items);
        return `
            <div class="payments-business-legend payments-points-legend">
                <button
                    type="button"
                    class="payments-business-legend-btn${focusKey === 'all' ? ' is-active' : ''}"
                    data-payments-points-focus-key="all"
                    aria-pressed="${focusKey === 'all' ? 'true' : 'false'}"
                    style="--payments-business-accent:${POINTS_BREAKDOWN_TONE_META.all.color};"
                >
                    <span class="payments-business-legend-dot"></span>
                    <span>全部分类</span>
                </button>
                ${items.map((item) => {
                    const toneMeta = getPointsBreakdownToneMeta(item);
                    const isActive = focusKey === item.key;
                    const isMuted = focusKey !== 'all' && !isActive;
                    return `
                        <button
                            type="button"
                            class="payments-business-legend-btn${isActive ? ' is-active' : ''}${isMuted ? ' is-muted' : ''}"
                            data-payments-points-focus-key="${escapeHtml(item.key)}"
                            aria-pressed="${isActive ? 'true' : 'false'}"
                            style="--payments-business-accent:${toneMeta.color};"
                        >
                            <span class="payments-business-legend-dot"></span>
                            <span>${escapeHtml(item.title || '积分分类')}</span>
                        </button>
                    `;
                }).join('')}
            </div>
        `;
    }

    function renderPointsBreakdownInspector(model, items) {
        const activeIndex = getPointsBreakdownActiveIndex(model);
        const activeLabel = model?.labels?.[activeIndex] || '当前';
        const focusKey = getResolvedPointsBreakdownFocusKey(items);
        const orderedItems = focusKey === 'all'
            ? items
            : [
                ...items.filter((item) => item.key === focusKey),
                ...items.filter((item) => item.key !== focusKey)
            ];

        return `
            <div class="payments-business-trend-inspector__head">
                <span class="payments-business-trend-inspector__eyebrow">${escapeHtml(model.modeLabel || '走势')}</span>
                <strong class="payments-business-trend-inspector__label">${escapeHtml(activeLabel)}</strong>
                <span class="payments-business-trend-inspector__note">${escapeHtml(model.note || '')}</span>
            </div>
            <div class="payments-business-trend-inspector__rows">
                ${orderedItems.map((item) => {
                    const meta = getPointsBreakdownToneMeta(item);
                    const values = getBusinessBreakdownSeriesValues(item, model.labels || []);
                    const currentValue = values[activeIndex] ?? item.latest ?? 0;
                    const previousValue = activeIndex > 0 ? (values[activeIndex - 1] ?? currentValue) : currentValue;
                    const delta = currentValue - previousValue;
                    const deltaDirection = getBusinessBreakdownDeltaDirection(delta);
                    return `
                        <button
                            type="button"
                            class="payments-business-trend-inspector__row${focusKey === item.key ? ' is-active' : ''}${focusKey !== 'all' && focusKey !== item.key ? ' is-muted' : ''}"
                            data-payments-points-focus-key="${escapeHtml(item.key)}"
                            aria-pressed="${focusKey === item.key ? 'true' : 'false'}"
                            style="--payments-business-accent:${meta.color};"
                        >
                            <span class="payments-business-trend-inspector__series">
                                <span class="payments-business-trend-inspector__dot" style="--payments-business-accent:${meta.color};"></span>
                                <span>${escapeHtml(item.title || '积分分类')}</span>
                            </span>
                            <span class="payments-business-trend-inspector__value">${escapeHtml(formatSignedPoints(currentValue))}</span>
                            <span class="payments-business-trend-inspector__delta trend-${escapeHtml(deltaDirection)}">${escapeHtml(deltaDirection === 'flat' ? '持平' : formatSignedPoints(delta))}</span>
                        </button>
                    `;
                }).join('')}
            </div>
        `;
    }

    function renderPointsBreakdownChartPanel(model, items) {
        if (!model.labels.length) {
            return '<div class="payments-breakdown-chart-empty">当前范围内暂无积分流水走势。</div>';
        }

        const hitareaStyle = [
            `left:${((model.chartLeft / model.width) * 100).toFixed(4)}%`,
            `right:${((model.chartRight / model.width) * 100).toFixed(4)}%`,
            `top:${((model.chartTop / model.height) * 100).toFixed(4)}%`,
            `bottom:${((model.chartBottom / model.height) * 100).toFixed(4)}%`,
            `--payments-business-columns:${Math.max(1, model.labels.length)}`
        ].join('; ');

        return `
            <div class="payments-business-trend-panel payments-points-trend-panel">
                <div class="payments-business-trend-head">
                    <div class="payments-business-trend-heading">
                        <div class="payments-business-trend-title">积分分类趋势</div>
                        <div class="payments-business-trend-subtitle">按日观察积分流入、流出与净流动，点选图例或右侧清单可聚焦单根曲线。</div>
                    </div>
                    <div class="payments-business-trend-range">
                        <strong>${escapeHtml(model.rangeLabel)}</strong>
                        <span>${escapeHtml(model.modeLabel)}</span>
                    </div>
                </div>
                ${renderPointsBreakdownLegend(items)}
                <div class="payments-business-trend-body">
                    <div class="payments-business-trend-plot-shell">
                        <div class="payments-business-trend-chart-note">${escapeHtml(model.note)}</div>
                        <div class="payments-business-trend-plot-frame">
                            <svg class="payments-business-trend-svg" viewBox="0 0 ${model.width} ${model.height}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
                                <rect class="payments-business-trend-plot-bg" x="${model.chartLeft}" y="${model.chartTop}" width="${model.plotWidth}" height="${model.plotHeight}" rx="18"></rect>
                                ${model.yTicks.map((tick) => `
                                    <g class="payments-business-trend-grid-row">
                                        <line class="payments-business-trend-grid-line" x1="${model.chartLeft}" y1="${tick.y}" x2="${model.width - model.chartRight}" y2="${tick.y}"></line>
                                        <text class="payments-business-trend-grid-label" x="${model.chartLeft - 12}" y="${tick.y + 4}" text-anchor="end">${escapeHtml(tick.label)}</text>
                                    </g>
                                `).join('')}
                                <line
                                    class="payments-business-trend-guide"
                                    data-payments-points-guide
                                    x1="${model.xPositions[getPointsBreakdownActiveIndex(model)]?.x ?? model.chartLeft}"
                                    y1="${model.chartTop}"
                                    x2="${model.xPositions[getPointsBreakdownActiveIndex(model)]?.x ?? model.chartLeft}"
                                    y2="${model.chartTop + model.plotHeight}"
                                ></line>
                                ${model.series.map((series) => `
                                    <g class="payments-business-trend-series${series.isFocused ? ' is-focused' : ''}${series.isMuted ? ' is-muted' : ''}" data-payments-points-series-key="${escapeHtml(series.key)}">
                                        ${series.showArea && series.areaPath
                                            ? `<path class="payments-business-trend-area" d="${series.areaPath}" style="--payments-business-series-color:${series.meta.color}; --payments-business-series-fill:${series.meta.fill};"></path>`
                                            : ''}
                                        <path class="payments-business-trend-line" d="${series.linePath}" style="--payments-business-series-color:${series.meta.color}; --payments-business-series-glow:${series.meta.glow};"></path>
                                    </g>
                                `).join('')}
                                ${model.xTickIndexes.map((tickIndex) => `
                                    <text
                                        class="payments-business-trend-axis-label"
                                        x="${model.xPositions[tickIndex]?.x ?? model.chartLeft}"
                                        y="${model.height - 10}"
                                        text-anchor="middle"
                                    >${escapeHtml(model.labels[tickIndex] || '')}</text>
                                `).join('')}
                            </svg>
                            <div class="payments-business-trend-point-layer" aria-hidden="true">
                                ${model.series.map((series) => series.points.map((point) => `
                                    <span
                                        class="payments-business-trend-point"
                                        data-payments-points-point-index="${point.index}"
                                        data-payments-points-point-key="${escapeHtml(series.key)}"
                                        style="left:${((point.x / model.width) * 100).toFixed(4)}%; top:${((point.y / model.height) * 100).toFixed(4)}%; --payments-business-series-color:${series.meta.color};"
                                    ></span>
                                `).join('')).join('')}
                            </div>
                            <div
                                class="payments-business-trend-hitareas"
                                style="${hitareaStyle};"
                            >
                                ${model.labels.map((label, index) => `
                                    <button
                                        type="button"
                                        class="payments-business-trend-hitarea"
                                        data-payments-points-index="${index}"
                                        aria-label="${escapeHtml(label)}"
                                    ></button>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                    <div class="payments-business-trend-inspector" data-payments-points-inspector></div>
                </div>
            </div>
        `;
    }

    function renderPointsBreakdownTable(items) {
        const focusKey = getResolvedPointsBreakdownFocusKey(items);
        return `
            <div class="payments-business-table-panel payments-points-table-panel">
                <div class="payments-business-table-head">
                    <div class="payments-business-table-title">积分明细</div>
                    <div class="payments-business-table-note">按净流动排序，保留流入/流出汇总与最近走势。</div>
                </div>
                <div class="payments-business-table-wrap">
                    <table class="payments-business-table payments-points-trend-table">
                        <thead>
                            <tr>
                                <th>分类</th>
                                <th>净流动</th>
                                <th>最近观测</th>
                                <th>日均</th>
                                <th>峰值</th>
                                <th>走势摘要</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${items.map((item) => {
                                const toneMeta = getPointsBreakdownToneMeta(item);
                                const deltaDirection = getBusinessBreakdownDeltaDirection(item.delta);
                                return `
                                    <tr
                                        class="payments-business-table-row${focusKey === item.key ? ' is-focused' : ''}${focusKey !== 'all' && focusKey !== item.key ? ' is-muted' : ''}"
                                        data-payments-points-row-key="${escapeHtml(item.key)}"
                                        style="--payments-business-accent:${toneMeta.color};"
                                    >
                                        <td>
                                            <div class="payments-business-table-label">
                                                <span class="payments-business-table-dot"></span>
                                                <div class="payments-business-table-copy">
                                                    <strong>${escapeHtml(item.title || '积分分类')}</strong>
                                                    <span>${escapeHtml(item.description || '—')}</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td>
                                            <div class="payments-business-table-value">
                                                <strong class="${Number(item.net || 0) < 0 ? 'is-negative' : 'is-positive'}">${escapeHtml(formatSignedPoints(item.net))}</strong>
                                                <span>${escapeHtml(item.meta || '')}</span>
                                            </div>
                                        </td>
                                        <td>
                                            <div class="payments-business-table-value">
                                                <strong>${escapeHtml(formatSignedPoints(item.latest))}</strong>
                                                <span>${escapeHtml(item.latestLabel || '当前')}</span>
                                            </div>
                                        </td>
                                        <td>${escapeHtml(formatSignedPoints(item.average))}</td>
                                        <td>${escapeHtml(formatSignedPoints(item.peak))}</td>
                                        <td>
                                            <div class="payments-business-table-trend">
                                                <span class="payments-business-table-trend-chip trend-${escapeHtml(deltaDirection)}">${escapeHtml(deltaDirection === 'flat' ? '持平' : (deltaDirection === 'up' ? '抬升' : '回落'))}</span>
                                                <span>${escapeHtml(deltaDirection === 'flat' ? '较前一日持平' : `较前一日 ${formatSignedPoints(item.delta)}`)}</span>
                                            </div>
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    function syncPointsBreakdownInteractiveState(target, model, items) {
        if (!target || !model?.labels?.length) return;

        const activeIndex = getPointsBreakdownActiveIndex(model);
        const focusKey = getResolvedPointsBreakdownFocusKey(items);
        const guideX = model.xPositions[activeIndex]?.x ?? model.chartLeft;
        const inspector = target.querySelector('[data-payments-points-inspector]');
        if (inspector) {
            inspector.innerHTML = renderPointsBreakdownInspector(model, items);
        }

        const guide = target.querySelector('[data-payments-points-guide]');
        if (guide) {
            guide.setAttribute('x1', guideX);
            guide.setAttribute('x2', guideX);
        }

        target.querySelectorAll('[data-payments-points-point-index]').forEach((pointNode) => {
            const pointIndex = Number(pointNode.dataset.paymentsPointsPointIndex || -1);
            const pointKey = String(pointNode.dataset.paymentsPointsPointKey || '').trim().toLowerCase();
            pointNode.classList.toggle('is-active', pointIndex === activeIndex);
            pointNode.classList.toggle('is-muted', focusKey !== 'all' && pointKey !== focusKey);
            pointNode.classList.toggle('is-focused', focusKey !== 'all' && pointKey === focusKey);
        });

        target.querySelectorAll('[data-payments-points-index]').forEach((hitareaNode) => {
            const hitareaIndex = Number(hitareaNode.dataset.paymentsPointsIndex || -1);
            hitareaNode.classList.toggle('is-active', hitareaIndex === activeIndex);
        });

        target.querySelectorAll('[data-payments-points-series-key]').forEach((seriesNode) => {
            const seriesKey = String(seriesNode.dataset.paymentsPointsSeriesKey || '').trim().toLowerCase();
            seriesNode.classList.toggle('is-focused', focusKey !== 'all' && focusKey === seriesKey);
            seriesNode.classList.toggle('is-muted', focusKey !== 'all' && focusKey !== seriesKey);
        });

        target.querySelectorAll('[data-payments-points-focus-key]').forEach((focusNode) => {
            const nodeKey = String(focusNode.dataset.paymentsPointsFocusKey || '').trim().toLowerCase() || 'all';
            const isActive = nodeKey === focusKey;
            const isMuted = focusKey !== 'all' && nodeKey !== 'all' && !isActive;
            focusNode.classList.toggle('is-active', isActive);
            focusNode.classList.toggle('is-muted', isMuted);
            focusNode.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });

        target.querySelectorAll('[data-payments-points-row-key]').forEach((rowNode) => {
            const rowKey = String(rowNode.dataset.paymentsPointsRowKey || '').trim().toLowerCase();
            rowNode.classList.toggle('is-focused', focusKey === rowKey);
            rowNode.classList.toggle('is-muted', focusKey !== 'all' && focusKey !== rowKey);
        });
    }

    function setPointsBreakdownFocusKey(focusKey = 'all') {
        const normalizedFocusKey = String(focusKey || 'all').trim().toLowerCase() || 'all';
        state.pointsBreakdownFocusKey = normalizedFocusKey === state.pointsBreakdownFocusKey && normalizedFocusKey !== 'all'
            ? 'all'
            : normalizedFocusKey;
        state.pointsBreakdownHoverIndex = null;
        renderPointsBreakdown(state.summary || {});
    }

    function bindPointsBreakdownInteractions(target, model, items) {
        if (!target) return;

        if (!target.dataset.paymentsPointsFocusBound) {
            target.addEventListener('click', (event) => {
                const focusButton = event.target.closest('[data-payments-points-focus-key]');
                if (!focusButton || !target.contains(focusButton)) return;
                setPointsBreakdownFocusKey(focusButton.dataset.paymentsPointsFocusKey || 'all');
            });
            target.dataset.paymentsPointsFocusBound = 'true';
        }

        target.querySelectorAll('[data-payments-points-index]').forEach((hitarea) => {
            const nextIndex = Number(hitarea.dataset.paymentsPointsIndex || -1);
            if (!Number.isInteger(nextIndex) || nextIndex < 0) return;

            hitarea.addEventListener('mouseenter', () => {
                state.pointsBreakdownHoverIndex = nextIndex;
                syncPointsBreakdownInteractiveState(target, model, items);
            });
            hitarea.addEventListener('focus', () => {
                state.pointsBreakdownHoverIndex = nextIndex;
                syncPointsBreakdownInteractiveState(target, model, items);
            });
        });

        const chartShell = target.querySelector('.payments-business-trend-plot-shell');
        if (chartShell) {
            chartShell.addEventListener('mouseleave', () => {
                state.pointsBreakdownHoverIndex = null;
                syncPointsBreakdownInteractiveState(target, model, items);
            });
        }
    }

    function renderPointsBreakdown(data) {
        const target = document.getElementById('paymentsPointsBreakdown');
        if (!target) return;
        const items = buildPointsBreakdownItems(data);

        if (!items.length) {
            target.innerHTML = '<div class="payments-empty-state">当前时间范围内暂无积分流水可汇总。</div>';
            return;
        }

        const model = buildPointsBreakdownChartModel(items);
        target.innerHTML = `
            <div class="payments-business-board payments-points-board">
                ${renderPointsBreakdownChartPanel(model, items)}
                ${renderPointsBreakdownTable(items)}
            </div>
        `;

        bindPointsBreakdownInteractions(target, model, items);
        syncPointsBreakdownInteractiveState(target, model, items);
    }

    function renderTrend(data) {
        const target = document.getElementById('paymentsTrendChart');
        const legend = document.getElementById('paymentsTrendLegend');
        if (!target || !legend) return;

        const items = Array.isArray(data?.trend_24h) ? data.trend_24h : [];
        const maxValue = items.reduce((max, item) => Math.max(max, Number(item.total_events || 0), Number(item.anomaly_events || 0)), 1);
        const labelStep = isUltraNarrowViewport() ? 8 : (isMobileViewport() ? 6 : 1);

        if (!items.length) {
            target.innerHTML = '<div class="payments-empty-state">最近 24 小时暂无回调数据。</div>';
            legend.innerHTML = '';
            return;
        }

        target.innerHTML = `
            <div class="payments-trend-bars">
                ${items.map((item, index) => {
                    const totalHeight = Math.max(6, Math.round((Number(item.total_events || 0) / maxValue) * 100));
                    const anomalyHeight = Math.max(0, Math.round((Number(item.anomaly_events || 0) / maxValue) * 100));
                    const rawLabel = String(item.label || '');
                    const timePart = rawLabel.includes(' ') ? rawLabel.split(' ')[1] : rawLabel.slice(6);
                    const shortLabel = isMobileViewport()
                        ? `${String(timePart || '').slice(0, 2)}时`
                        : timePart;
                    const showLabel = labelStep === 1 || index % labelStep === 0 || index === items.length - 1;
                    return `
                        <div class="payments-trend-bar ${showLabel ? 'show-label' : ''}" title="${escapeHtml(item.label)} · 总回调 ${escapeHtml(formatNumber(item.total_events))} · 异常 ${escapeHtml(formatNumber(item.anomaly_events))}">
                            <div class="payments-trend-bar-visual" aria-hidden="true">
                                <svg class="payments-trend-bar-svg" viewBox="0 0 24 100" preserveAspectRatio="none">
                                    <defs>
                                        <linearGradient id="paymentsTrendTotalGradient-${index}" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stop-color="#60a5fa" stop-opacity="0.95"></stop>
                                            <stop offset="100%" stop-color="#3b82f6" stop-opacity="0.36"></stop>
                                        </linearGradient>
                                        <linearGradient id="paymentsTrendAnomalyGradient-${index}" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stop-color="#f87171" stop-opacity="0.96"></stop>
                                            <stop offset="100%" stop-color="#dc2626" stop-opacity="0.42"></stop>
                                        </linearGradient>
                                    </defs>
                                    <rect class="payments-trend-bar-total" x="0" y="${100 - totalHeight}" width="24" height="${totalHeight}" rx="12" fill="url(#paymentsTrendTotalGradient-${index})"></rect>
                                    <rect class="payments-trend-bar-anomaly" x="0" y="${100 - anomalyHeight}" width="24" height="${anomalyHeight}" rx="12" fill="url(#paymentsTrendAnomalyGradient-${index})"></rect>
                                </svg>
                            </div>
                            <span>${showLabel ? escapeHtml(shortLabel) : ''}</span>
                        </div>
                    `;
                }).join('')}
            </div>
        `;

        const totalEvents = items.reduce((sum, item) => sum + Number(item.total_events || 0), 0);
        const anomalyEvents = items.reduce((sum, item) => sum + Number(item.anomaly_events || 0), 0);
        const failedEvents = items.reduce((sum, item) => sum + Number(item.failed_events || 0), 0);
        legend.innerHTML = `
            <span><i class="fas fa-circle"></i> 总回调 ${escapeHtml(formatNumber(totalEvents))}</span>
            <span class="danger"><i class="fas fa-circle"></i> 异常 ${escapeHtml(formatNumber(anomalyEvents))}</span>
            <span class="warning"><i class="fas fa-circle"></i> 高危 ${escapeHtml(formatNumber(failedEvents))}</span>
        `;
    }

    function renderAnomalies(data) {
        const target = document.getElementById('paymentsAnomalyList');
        if (!target) return;
        const anomalies = Array.isArray(data?.recent_anomalies) ? data.recent_anomalies : [];

        if (!anomalies.length) {
            target.innerHTML = '<div class="payments-empty-state">当前没有新的异常项，继续保持监控即可。</div>';
            return;
        }

        const pager = paginateItems(anomalies, 'anomalies');

        target.innerHTML = `
            <div class="payments-anomaly-items">
                ${pager.pageItems.map((item) => `
            <div class="payments-anomaly-item severity-${escapeHtml(item.severity || 'info')}">
                <div class="payments-anomaly-top">
                    <div class="payments-anomaly-copy">
                        <div class="payments-anomaly-title">${escapeHtml(item.title || '异常项')}</div>
                        <div class="payments-anomaly-message">${escapeHtml(item.message || '')}</div>
                    </div>
                    <span class="payments-anomaly-severity">${escapeHtml(getSeverityLabel(item.severity))}</span>
                </div>
                ${renderAnomalyOpsState(item)}
                <div class="payments-anomaly-suggestion">
                    <i class="fas fa-lightbulb"></i>
                    <span>${escapeHtml(getHandlingSuggestion(item))}</span>
                </div>
                <div class="payments-anomaly-meta">
                    <span><small>类型</small><strong>${escapeHtml(getAnomalyTypeLabel(item))}</strong></span>
                    <span><small>通道</small><strong>${escapeHtml(getProviderLabel(item.provider))}</strong></span>
                    ${renderPaymentInitiatorMeta(item)}
                    <span><small>${escapeHtml(getAnomalyReferenceLabel(item))}</small><strong>${escapeHtml(getAnomalyReferenceValue(item))}</strong></span>
                    <span><small>时间</small><strong>${escapeHtml(formatDateTime(item.created_at))}</strong></span>
                </div>
                ${renderAnomalyActions(item)}
            </div>
                `).join('')}
            </div>
            ${renderPager('anomalies', pager.currentPage, pager.totalPages, pager.totalItems)}
        `;
    }

    function renderExceptionTopics(data) {
        const topicsTarget = document.getElementById('paymentsExceptionTopics');
        const listTarget = document.getElementById('paymentsExceptionTopicList');
        if (!topicsTarget || !listTarget) return;

        const topics = Array.isArray(data?.exception_topics) ? data.exception_topics : [];
        const items = Array.isArray(data?.exception_topic_items) ? data.exception_topic_items : [];
        const topicMap = new Map(
            topics.map((topic) => [String(topic?.key || '').trim().toLowerCase(), topic])
        );
        const topicLabels = topics
            .map((topic) => String(topic?.label || '').trim())
            .filter(Boolean);
        const topicCardDefinitions = [
            {
                key: 'all',
                label: '全部专题',
                icon: 'fas fa-layer-group',
                severity: 'info',
                description: topicLabels.length
                    ? `覆盖 ${topicLabels.join('、')}。`
                    : '当前范围内所有支付异常专题。'
            },
            {
                key: 'duplicate_webhook',
                label: '重复回调',
                icon: 'fas fa-wave-square',
                severity: 'warning',
                description: '重点关注是否只是重复通知，还是已经造成重复入账、重复回填。'
            },
            {
                key: 'payment_intent_issues',
                label: '支付意图异常',
                icon: 'fas fa-link-slash',
                severity: 'warning',
                description: '重点关注支付意图拉起失败、长时间未回填，或已完成但未关联正式订单。',
                topicKeys: PAYMENT_INTENT_EXCEPTION_TOPIC_KEYS
            },
            {
                key: 'refund_failures',
                label: '退款失败',
                icon: 'fas fa-rotate-left',
                severity: 'warning',
                description: '网关退款失败，但系统已自动补回积分，仍需复核通道响应和重复提交风险。'
            },
            {
                key: 'refund_reclaim_failures',
                label: '扣回失败',
                icon: 'fas fa-shield-halved',
                severity: 'critical',
                description: '已入账订单在退款前无法安全扣回积分，当前退款已 fail-closed 停止。'
            }
        ];
        const allowedTopicKeys = new Set(topicCardDefinitions.map((item) => item.key));
        const rawActiveFilter = normalizeExceptionTopicFilterKey(state.exceptionTopicFilter || 'all');
        const activeFilter = allowedTopicKeys.has(rawActiveFilter) ? rawActiveFilter : 'all';
        const filteredItems = getExceptionTopicFilteredItems(data, activeFilter);
        const totalTopicCount = topics.reduce((sum, topic) => sum + Number(topic?.count || 0), 0);
        const split = splitItemsByResolution(filteredItems, (item) => item?.ops_status);
        const activeItems = split.activeItems;
        const resolvedItems = split.resolvedItems;
        const handledItems = filterItemsByStatuses(resolvedItems, ['handled', 'approved']);
        const ignoredItems = filterItemsByStatuses(resolvedItems, ['ignored', 'rejected']);
        const archivedItems = filterItemsByStatuses(resolvedItems, ['archived']);
        const topicCards = topicCardDefinitions.map((definition) => {
            const topicKeys = Array.isArray(definition.topicKeys) && definition.topicKeys.length
                ? definition.topicKeys
                : [definition.key];
            const matchedTopics = topicKeys
                .map((key) => topicMap.get(String(key || '').trim().toLowerCase()))
                .filter(Boolean);
            const topic = matchedTopics[0] || topicMap.get(definition.key);
            const severity = matchedTopics.some((item) => String(item?.severity || '').trim().toLowerCase() === 'critical')
                ? 'critical'
                : matchedTopics.some((item) => String(item?.severity || '').trim().toLowerCase() === 'warning')
                    ? 'warning'
                    : String(topic?.severity || definition.severity || 'info').trim().toLowerCase();
            return {
                ...definition,
                label: Array.isArray(definition.topicKeys) && definition.topicKeys.length
                    ? String(definition.label || '').trim()
                    : String(topic?.label || definition.label).trim(),
                severity,
                description: Array.isArray(definition.topicKeys) && definition.topicKeys.length
                    ? String(definition.description || '').trim()
                    : String(topic?.description || definition.description || '').trim(),
                count: definition.key === 'all'
                    ? totalTopicCount
                    : topicKeys.reduce((sum, key) => sum + Math.max(0, Number(topicMap.get(String(key || '').trim().toLowerCase())?.count || 0) || 0), 0)
            };
        });
        const activeTopicCard = topicCards.find((topic) => topic.key === activeFilter) || topicCards[0];
        const handledCount = resolvedItems.filter((item) => ['handled', 'approved'].includes(normalizeStatusValue(item?.ops_status))).length;
        const ignoredCount = resolvedItems.filter((item) => ['ignored', 'rejected'].includes(normalizeStatusValue(item?.ops_status))).length;
        const archivedCount = resolvedItems.filter((item) => normalizeStatusValue(item?.ops_status) === 'archived').length;
        const batchArchiveLoading = isBatchAnomalyActionLoading('exception-topic-handled', 'archive');

        topicsTarget.innerHTML = `
            <div class="payments-exception-topic-grid">
            ${topicCards.map((topic) => `
                <button
                    type="button"
                    class="payments-exception-topic-card payments-exception-topic-card--${escapeHtml(topic.severity === 'critical' ? 'critical' : (topic.severity === 'warning' ? 'warning' : 'info'))}${activeFilter === topic.key ? ' is-active' : ''}"
                    data-admin-action="payments-set-exception-topic-filter"
                    data-payments-topic-key="${escapeHtml(topic.key)}"
                    aria-pressed="${activeFilter === topic.key ? 'true' : 'false'}"
                >
                    <span class="payments-exception-topic-card__top">
                        <span class="payments-exception-topic-card__title"><i class="${escapeHtml(topic.icon)}"></i>${escapeHtml(topic.label || '专题')}</span>
                        <span class="payments-mini-badge ${escapeHtml(topic.severity === 'critical' ? 'danger' : (topic.severity === 'warning' ? 'warning' : 'info'))}">${escapeHtml(formatNumber(topic.count || 0))} 项</span>
                    </span>
                    <span class="payments-exception-topic-card__desc">${escapeHtml(topic.description || '')}</span>
                </button>
            `).join('')}
            </div>
        `;

        if (!filteredItems.length) {
            listTarget.innerHTML = '<div class="payments-empty-state compact">当前专题下没有新的明细项。</div>';
            return;
        }

        listTarget.innerHTML = `
            <div class="payments-exception-topic-detail-head">
                <div>
                    <strong>${escapeHtml(activeTopicCard?.label || '全部专题')}</strong>
                    <span>${escapeHtml(activeTopicCard?.description || '当前激活专题的待处理、已处理、已忽略和已归档明细。')}</span>
                </div>
                <div class="payments-provider-badges">
                    ${renderMiniCountBadge('待处理', activeItems.length, activeItems.length ? 'warning' : 'muted')}
                    ${handledCount > 0 ? renderMiniCountBadge('已处理', handledCount, 'success') : ''}
                    ${ignoredCount > 0 ? renderMiniCountBadge('已忽略', ignoredCount, 'muted') : ''}
                    ${archivedCount > 0 ? renderMiniCountBadge('已归档', archivedCount, 'muted') : ''}
                </div>
            </div>
            ${activeItems.length ? `
                <div class="payments-anomaly-items">
                    ${renderExceptionTopicItemsHtml(activeItems)}
                </div>
            ` : ''}
            ${handledItems.length ? renderCollapsedHandledSection({
                title: '已处理',
                description: '已处理和已审核通过的专题卡片默认收起，避免列表持续向下堆叠。',
                badges: [
                    renderMiniCountBadge('已处理', resolvedItems.filter((item) => normalizeStatusValue(item?.ops_status) === 'handled').length, 'success'),
                    renderMiniCountBadge('已通过', resolvedItems.filter((item) => normalizeStatusValue(item?.ops_status) === 'approved').length, 'success')
                ],
                actionButton: handledItems.length > 1
                    ? `
                        <button
                            type="button"
                            class="payments-anomaly-action-btn archive compact"
                            data-admin-action="payments-batch-anomaly-action"
                            data-payments-batch-scope="exception-topic-handled"
                            data-payments-action="archive"
                            ${batchArchiveLoading ? 'disabled' : ''}
                        >
                            ${escapeHtml(batchArchiveLoading ? '归档中...' : `批量归档 ${formatNumber(handledItems.length)} 条`)}
                        </button>
                    `
                    : '',
                body: handledItems.length ? `<div class="payments-anomaly-items">${renderExceptionTopicItemsHtml(handledItems)}</div>` : ''
            }) : ''}
            ${ignoredItems.length ? renderCollapsedHandledSection({
                title: '已忽略',
                description: '已忽略和已驳回的专题项也会保留在这里，方便后续复查，不会直接消失。',
                badges: [
                    renderMiniCountBadge('已忽略', resolvedItems.filter((item) => normalizeStatusValue(item?.ops_status) === 'ignored').length, 'muted'),
                    renderMiniCountBadge('已驳回', resolvedItems.filter((item) => normalizeStatusValue(item?.ops_status) === 'rejected').length, 'danger')
                ],
                body: ignoredItems.length
                    ? `<div class="payments-anomaly-items">${renderExceptionTopicItemsHtml(ignoredItems)}</div>`
                    : '<div class="payments-empty-state compact">当前没有已忽略或已驳回的专题项。</div>'
            }) : ''}
            ${archivedItems.length ? renderCollapsedHandledSection({
                title: '已归档',
                description: '归档后的专题项会保留在这里，方便回头复核，但不会再计入上方四个专题卡片数字。',
                badges: [
                    renderMiniCountBadge('已归档', archivedItems.length, 'muted')
                ],
                body: archivedItems.length
                    ? `<div class="payments-anomaly-items">${renderExceptionTopicItemsHtml(archivedItems)}</div>`
                    : '<div class="payments-empty-state compact">当前没有已归档的专题项。</div>'
            }) : ''}
        `;
    }

    function renderCheckoutSessions(data) {
        const target = document.getElementById('paymentsCheckoutSessionsList');
        if (!target) return;

        const sessions = Array.isArray(data?.recent_checkout_sessions) ? data.recent_checkout_sessions : [];

        if (!sessions.length) {
            target.innerHTML = '<div class="payments-empty-state">当前时间范围内暂无需要跟踪的支付意图会话。</div>';
            return;
        }

        const pager = paginateItems(sessions, 'sessions');

        target.innerHTML = `
            ${pager.pageItems.map((session) => {
                const matchInfo = getCheckoutSessionTraceMatchInfo(session);
                const statusTone = getCheckoutSessionStatusTone(session?.status);
                const packageName = String(session?.package_name || '').trim() || '自定义充值';
                const sessionKey = String(session?.session_key || '').trim();
                const providerOrderNo = String(session?.provider_order_no || '').trim();
                const siteLabel = String(session?.site || 'cn').trim().toUpperCase() || 'CN';
                const linkedAt = session?.linked_at ? formatDateTime(session.linked_at) : '';
                const completedAt = session?.completed_at ? formatDateTime(session.completed_at) : '';
                const expiresAt = session?.expires_at ? formatDateTime(session.expires_at) : '';
                const timelineLabel = linkedAt
                    ? `回填 ${linkedAt}`
                    : completedAt
                        ? `完成 ${completedAt}`
                        : expiresAt
                            ? `过期 ${expiresAt}`
                            : `更新 ${formatDateTime(session?.updated_at || session?.created_at)}`;

                return `
                    <div class="payments-provider-row">
                        <div class="payments-provider-copy">
                            <div class="payments-provider-name">
                                <i class="${escapeHtml(getProviderIcon(session?.provider))}"></i>${escapeHtml(packageName)}
                            </div>
                            <div class="payments-provider-meta">
                                发起人 ${escapeHtml(String(session?.user_email || '').trim() || (String(session?.user_id || '').trim() ? '未绑定邮箱' : '匿名 / 未识别用户'))}
                                ·
                                ${escapeHtml(getProviderLabel(session?.provider))}
                                · ${escapeHtml(siteLabel)}
                                · 会话 ${escapeHtml(sessionKey || '—')}
                                ${providerOrderNo ? ` · 参考单号 ${escapeHtml(providerOrderNo)}` : ''}
                            </div>
                            <div class="payments-provider-extra">
                                <span>应付 ${escapeHtml(formatCurrency(session?.expected_amount))}</span>
                                <span>到账 ${escapeHtml(formatNumber(session?.granted_points))} 积分</span>
                                <span>创建 ${escapeHtml(formatDateTime(session?.created_at))}</span>
                                <span>${escapeHtml(timelineLabel)}</span>
                            </div>
                            <div class="payments-provider-meta">${escapeHtml(getCheckoutSessionTraceDetail(session))}</div>
                        </div>
                        <div class="payments-provider-badges">
                            <span class="payments-mini-badge ${escapeHtml(statusTone)}">${escapeHtml(getSessionStatusLabel(session?.status))}</span>
                            <span class="payments-mini-badge ${escapeHtml(matchInfo.tone)}">${escapeHtml(matchInfo.label)}</span>
                            ${session?.has_checkout_url ? '<span class="payments-mini-badge info">已生成支付页</span>' : ''}
                        </div>
                    </div>
                `;
            }).join('')}
            ${renderPager('sessions', pager.currentPage, pager.totalPages, pager.totalItems)}
        `;
    }

    function renderOrders(data) {
        const target = document.getElementById('paymentsOrdersTable');
        if (!target) return;
        const orders = Array.isArray(data?.recent_orders) ? data.recent_orders : [];
        const focusedOrderIndex = getFocusedOrderIndex(orders);

        if (focusedOrderIndex >= 0) {
            state.pagination.orders = Math.floor(focusedOrderIndex / PAYMENTS_PAGE_SIZE) + 1;
        }

        if (!orders.length) {
            target.innerHTML = '<div class="payments-empty-state">当前时间范围内暂无支付订单。</div>';
            return;
        }

        const pager = paginateItems(orders, 'orders');

        function renderOrderMatchBadge(order) {
            const info = getCheckoutSessionMatchInfo(order);
            return `<span class="payments-mini-badge ${escapeHtml(info.tone || 'muted')}">${escapeHtml(info.label)}</span>`;
        }

        if (isMobileViewport()) {
            target.innerHTML = `
                <div class="payments-order-cards">
                    ${pager.pageItems.map((order) => {
                        const isFocusedOrder = matchesFocusedOrder(order);
                        const settlementLabel = getPaymentOrderSettlementLabel(order);
                        return `
                        <div class="payments-order-card${isFocusedOrder ? ' payments-order-card--focused' : ''}" data-payments-focused-order="${isFocusedOrder ? '1' : '0'}">
                            <div class="payments-order-card-top">
                                <div class="payments-order-card-primary">
                                    <div class="payments-order-user">${renderPaymentsOrderUser(order)}</div>
                                    ${renderPaymentsOrderNo(order)}
                                    <div class="payments-order-provider">${escapeHtml(getProviderLabel(order.provider))} · ${(order.site || 'cn').toUpperCase()}</div>
                                </div>
                                <span class="payments-status-badge status-${escapeHtml(order.status || 'pending')}">${escapeHtml(getStatusLabel(order.status))}</span>
                            </div>
                            <div class="payments-order-card-grid">
                                <div class="payments-order-card-field">
                                    <label>套餐</label>
                                    <strong>${escapeHtml(order.package_name || '未匹配套餐')}</strong>
                                </div>
                                <div class="payments-order-card-field">
                                    <label>金额</label>
                                    <strong>${escapeHtml(formatPaymentOrderAmount(order))}</strong>
                                    ${settlementLabel ? `<span>${escapeHtml(settlementLabel)}</span>` : ''}
                                </div>
                                <div class="payments-order-card-field">
                                    <label>积分</label>
                                    <span>${escapeHtml(formatNumber(order.points_amount))}</span>
                                </div>
                                <div class="payments-order-card-field">
                                    <label>创建时间</label>
                                    <span>${escapeHtml(formatDateTime(order.created_at))}</span>
                                </div>
                                <div class="payments-order-card-field payments-order-card-field--match">
                                    <label>意图匹配</label>
                                    <span>${renderOrderMatchBadge(order)}</span>
                                </div>
                                <div class="payments-order-card-field">
                                    <label>认领时间</label>
                                    <span>${escapeHtml(formatDateTime(order.claimed_at))}</span>
                                </div>
                            </div>
                            <div class="payments-order-card-actions">
                                ${renderOrderActions(order)}
                            </div>
                        </div>
                    `;
                    }).join('')}
                </div>
                ${renderPager('orders', pager.currentPage, pager.totalPages, pager.totalItems)}
            `;
            if (focusedOrderIndex >= 0) {
                scrollFocusedOrderIntoView();
            }
            return;
        }

        target.innerHTML = `
            <div class="payments-table-wrap">
                <table class="payments-table payments-orders-grid-table">
                    <thead>
                        <tr>
                            <th>用户邮箱</th>
                            <th>订单号</th>
                            <th>套餐</th>
                            <th>金额</th>
                            <th>积分</th>
                            <th>状态</th>
                            <th>意图匹配</th>
                            <th>站点</th>
                            <th>创建时间</th>
                            <th>认领时间</th>
                            <th>操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${pager.pageItems.map((order) => {
                            const isFocusedOrder = matchesFocusedOrder(order);
                            const settlementLabel = getPaymentOrderSettlementLabel(order);
                            return `
                            <tr class="${isFocusedOrder ? 'payments-order-row--focused' : ''}" data-payments-focused-order="${isFocusedOrder ? '1' : '0'}">
                                <td>${renderPaymentsOrderUser(order)}</td>
                                <td>
                                    ${renderPaymentsOrderNo(order)}
                                    <div class="payments-order-provider">${escapeHtml(getProviderLabel(order.provider))}</div>
                                </td>
                                <td>${escapeHtml(order.package_name || '未匹配套餐')}</td>
                                <td>
                                    ${escapeHtml(formatPaymentOrderAmount(order))}
                                    ${settlementLabel ? `<div class="payments-order-provider">${escapeHtml(settlementLabel)}</div>` : ''}
                                </td>
                                <td>${escapeHtml(formatNumber(order.points_amount))}</td>
                                <td><span class="payments-status-badge status-${escapeHtml(order.status || 'pending')}">${escapeHtml(getStatusLabel(order.status))}</span></td>
                                <td>${renderOrderMatchBadge(order)}</td>
                                <td>${escapeHtml((order.site || 'cn').toUpperCase())}</td>
                                <td>${escapeHtml(formatDateTime(order.created_at))}</td>
                                <td>${escapeHtml(formatDateTime(order.claimed_at))}</td>
                                <td>${renderOrderActions(order)}</td>
                            </tr>
                        `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
            ${renderPager('orders', pager.currentPage, pager.totalPages, pager.totalItems)}
        `;
        if (focusedOrderIndex >= 0) {
            scrollFocusedOrderIntoView();
        }
    }

    function renderCleanupPreview(payload) {
        const target = document.getElementById('paymentsCleanupPreview');
        if (!target) return;

        const preview = payload?.preview || payload || {};
        const counts = preview.counts || {};
        const sampleOrders = preview.samples?.orders || [];
        const sampleUsers = preview.samples?.users || [];
        state.cleanupPreview = preview;
        const cleanupTotal = getCleanupTotalCount(counts);
        const hasManagedCleanupCard = Boolean(document.getElementById('paymentsCleanupCard'));
        setCleanupCardVisible(cleanupTotal > 0);
        if (hasManagedCleanupCard && cleanupTotal <= 0) {
            target.innerHTML = '';
            return;
        }

        const orderPager = paginateItems(sampleOrders, 'cleanupOrders');
        const userPager = paginateItems(sampleUsers, 'cleanupUsers');

        target.innerHTML = `
            <div class="payments-cleanup-grid">
                <div class="payments-cleanup-stat">
                    <span>测试订单</span>
                    <strong>${escapeHtml(formatNumber(counts.payment_orders))}</strong>
                </div>
                <div class="payments-cleanup-stat">
                    <span>测试回调</span>
                    <strong>${escapeHtml(formatNumber(counts.payment_events))}</strong>
                </div>
                <div class="payments-cleanup-stat">
                    <span>爱发电映射单</span>
                    <strong>${escapeHtml(formatNumber(counts.afdian_orders))}</strong>
                </div>
                <div class="payments-cleanup-stat">
                    <span>测试账号</span>
                    <strong>${escapeHtml(formatNumber(counts.auth_users))}</strong>
                </div>
            </div>
            <div class="payments-cleanup-note">
                ${CLEANUP_SCOPE_HTML}
            </div>
            <div class="payments-cleanup-samples">
                <div>
                    <h4>样例订单</h4>
                    ${sampleOrders.length ? `
                        <ul>
                            ${orderPager.pageItems.map((item) => `<li>${escapeHtml(item.provider_order_no)} · ${escapeHtml(getStatusLabel(item.status))} · ${escapeHtml(formatDateTime(item.created_at))}</li>`).join('')}
                        </ul>
                        ${renderPager('cleanupOrders', orderPager.currentPage, orderPager.totalPages, orderPager.totalItems)}
                    ` : '<div class="payments-empty-state compact">未扫描到测试订单。</div>'}
                </div>
                <div>
                    <h4>样例账号</h4>
                    ${sampleUsers.length ? `
                        <ul>
                            ${userPager.pageItems.map((item) => `<li>${escapeHtml(item.email || item.id)}</li>`).join('')}
                        </ul>
                        ${renderPager('cleanupUsers', userPager.currentPage, userPager.totalPages, userPager.totalItems)}
                    ` : '<div class="payments-empty-state compact">未扫描到测试账号。</div>'}
                </div>
            </div>
        `;
    }

    function rerenderCurrentView() {
        if (!state.summary) return;
        if (state.activeTab === 'overview' && state.overviewStage !== 'full') {
            renderOverviewCards(state.summary);
            updateOverviewBanner(state.summary);
            if (state.overviewSecondaryLoaded) {
                renderRefundAlerts(state.summary);
                renderProviderStats(state.summary);
                renderTrend(state.summary);
            }
            return;
        }

        renderRefundAlerts(state.summary);
        renderOverviewCards(state.summary);
        renderProviderStats(state.summary);
        renderSitewideSummary(state.summary);
        renderBusinessBreakdown(state.summary);
        renderPointsBreakdown(state.summary);
        renderTrend(state.summary);
        renderOpsAlertQueue(state.summary);
        renderExceptionTopics(state.summary);
        renderAnomalies(state.summary);
        renderCheckoutSessions(state.summary);
        renderOrders(state.summary);
        if (state.cleanupPreview) {
            renderCleanupPreview({ preview: state.cleanupPreview });
        }
    }

    function renderCleanupPreviewFallback(message) {
        const target = document.getElementById('paymentsCleanupPreview');
        if (!target) return;
        state.cleanupPreview = null;
        setCleanupCardVisible(true);

        target.innerHTML = `
            <div class="payments-access-state warning">
                <i class="fas fa-triangle-exclamation"></i>
                <span>${escapeHtml(message || '测试数据扫描暂时不可用，请稍后再试。')}</span>
            </div>
            <div class="payments-cleanup-note">
                不影响上方支付概览和异常队列。${CLEANUP_SCOPE_HTML}
            </div>
        `;
    }

    function resolvePaymentsActionFeedbackTarget(targetType = '', targetId = '') {
        const normalizedTargetType = String(targetType || '').trim().toLowerCase();
        const normalizedTargetId = String(targetId || '').trim();
        if (!normalizedTargetType || !normalizedTargetId || !state.summary) {
            return null;
        }

        if (normalizedTargetType === 'order') {
            return (Array.isArray(state.summary?.recent_orders) ? state.summary.recent_orders : [])
                .find((item) => String(item?.id || '').trim() === normalizedTargetId) || null;
        }

        const rows = [
            ...(Array.isArray(state.summary?.recent_anomalies) ? state.summary.recent_anomalies : []),
            ...(Array.isArray(state.summary?.refund_alert_items) ? state.summary.refund_alert_items : []),
            ...(Array.isArray(state.summary?.ops_alert_items) ? state.summary.ops_alert_items : []),
            ...(Array.isArray(state.summary?.exception_topic_items) ? state.summary.exception_topic_items : [])
        ];

        return rows.find((item) => String(item?.id || '').trim() === normalizedTargetId && String(item?.type || '').trim().toLowerCase() === normalizedTargetType) || null;
    }

    function recordPaymentsResolutionFeedback(targetType = '', targetId = '', action = '') {
        if (typeof window.recordAnalyticsResolutionFeedback !== 'function' || !hasWorkbenchContext(state.workbenchContext)) {
            return null;
        }

        const normalizedTargetType = String(targetType || '').trim().toLowerCase();
        const normalizedTargetId = String(targetId || '').trim();
        const target = resolvePaymentsActionFeedbackTarget(targetType, targetId) || {};
        const actionLabel = getAnomalyActionLabel(action);
        const referenceLabel = String(
            state.workbenchContext?.referenceLabel
            || (normalizedTargetType === 'order' ? '支付订单' : getAnomalyReferenceLabel(target))
            || '支付问题'
        ).trim();
        const referenceValue = String(
            state.workbenchContext?.referenceValue
            || state.workbenchContext?.queryLabel
            || state.workbenchContext?.query
            || (normalizedTargetType === 'order'
                ? (target?.provider_order_no || target?.package_name || targetId)
                : getAnomalyReferenceValue(target))
            || targetId
        ).trim();
        const title = `${actionLabel} · ${referenceValue || state.workbenchContext?.productName || '支付异常'}`;
        const summary = String(
            normalizedTargetType === 'order'
                ? `已在支付页处理 ${referenceLabel}“${referenceValue || targetId}”，建议回到商品分析确认订单或转化信号是否回落。`
                : `已围绕 ${referenceLabel}“${referenceValue || targetId}”执行 ${actionLabel}，建议回到商品分析确认预警是否收口。`
        ).trim();
        const feedbackScope = String(state.workbenchContext?.feedbackScope || '').trim().toLowerCase();
        const feedbackEntityType = String(state.workbenchContext?.feedbackEntityType || 'payments').trim().toLowerCase() || 'payments';
        const feedbackEntityId = String(
            state.workbenchContext?.feedbackEntityId
            || normalizedTargetId
            || normalizedTargetType
            || state.issueSummaryFocus
            || feedbackEntityType
        ).trim() || feedbackEntityType;
        const feedbackEntityName = String(
            state.workbenchContext?.feedbackEntityName
            || referenceValue
            || referenceLabel
            || '支付问题'
        ).trim() || '支付问题';
        const normalizedAction = String(action || '').trim().toLowerCase();
        const statusKey = normalizedAction === 'request_retry' || normalizedAction === 'reopen'
            ? 'abnormal'
            : ((normalizedAction === 'ignore' || normalizedAction === 'reject_review' || normalizedAction === 'reject_amount_mismatch')
                ? 'review'
                : 'resolved');
        const statusLabel = statusKey === 'abnormal'
            ? '仍异常'
            : (statusKey === 'review' ? '待复查' : '已处理');

        return window.recordAnalyticsResolutionFeedback({
            module: 'payments',
            productId: state.workbenchContext?.productId,
            productName: state.workbenchContext?.productName,
            feedbackScope,
            entityType: feedbackEntityType,
            entityId: feedbackEntityId,
            entityName: feedbackEntityName,
            title,
            summary,
            actionLabel,
            referenceLabel,
            referenceValue,
            tone: statusKey === 'abnormal' ? 'danger' : (statusKey === 'review' ? 'warning' : 'success'),
            statusKey,
            statusLabel
        });
    }

    function emitPaymentsCommandFeedback(message = '', feedbackState = 'saved', options = {}) {
        const normalizedMessage = String(message || '').trim();
        if (!normalizedMessage) {
            return null;
        }

        const detail = {
            kind: 'module-result',
            source: String(options?.source || 'payments-ops').trim().toLowerCase() || 'payments-ops',
            module: 'payments',
            state: String(feedbackState || options?.state || 'saved').trim().toLowerCase() || 'saved',
            tone: String(options?.tone || '').trim().toLowerCase(),
            message: normalizedMessage,
            persistent: options?.persistent === true,
            timestamp: Date.now()
        };

        if (typeof window.dispatchAdminStudioFeedbackSignal === 'function') {
            return window.dispatchAdminStudioFeedbackSignal(detail);
        }

        if (typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
            try {
                window.dispatchEvent(new CustomEvent('admin-feedback-signal', { detail }));
            } catch (_) {
                // Feedback must never block the payment operation itself.
            }
        }

        return detail;
    }

    function getPaymentsIssueSummaryFocusMessage(kind = '') {
        const normalizedKind = String(kind || '').trim().toLowerCase();
        if (normalizedKind === 'refund') {
            return '支付分析已切换到退款异常主题';
        }
        if (normalizedKind === 'ops') {
            return '支付分析已切换到运维告警队列';
        }
        if (normalizedKind === 'dead_letter') {
            return '支付分析已切换到死信告警队列';
        }
        if (normalizedKind === 'retry') {
            return '支付分析已切换到重试告警队列';
        }
        if (normalizedKind === 'review') {
            return '支付分析已切换到人工复核队列';
        }
        if (normalizedKind === 'failed') {
            return '支付分析已切换到失败订单队列';
        }
        return '支付分析聚焦视图已打开';
    }

    function getPaymentsPriorityFocusMessage(action = '', target = '') {
        const normalizedAction = String(action || '').trim().toLowerCase();
        const normalizedTarget = String(target || '').trim();
        if (normalizedAction === 'topic' && normalizedTarget) {
            return `支付优先级已切换到异常主题 ${normalizedTarget}`;
        }
        if (normalizedAction === 'ops') {
            return '支付优先级已切换到运维告警队列';
        }
        return '';
    }

    function emitPaymentsOrderFocusResult(orderId = '', focusResult = null) {
        const normalizedOrderId = String(orderId || '').trim();
        if (!normalizedOrderId) {
            return null;
        }

        const normalizedResult = focusResult && typeof focusResult === 'object' ? focusResult : {};
        return emitPaymentsCommandFeedback(
            normalizedResult?.matched
                ? `支付订单 ${normalizedOrderId} 已定位`
                : `支付订单 ${normalizedOrderId} 已打开，最近订单列表未匹配`,
            normalizedResult?.matched ? 'saved' : 'partial',
            { source: 'payments-focus' }
        );
    }

    async function loadSummary(requestToken, targetTab = state.activeTab) {
        const requestedTab = String(targetTab || state.activeTab || 'overview').trim().toLowerCase() || 'overview';
        const requestCacheKey = getCurrentCacheKey();

        if (requestedTab === 'overview') {
            state.overviewStage = 'loading';
            state.overviewSecondaryLoaded = false;
            state.overviewOpsLoaded = false;
            renderOverviewSecondarySkeletons();

            const coreQuery = buildSummaryQuery('overview', { scope: 'core' });
            const corePayload = await fetchAdminJson(`/api/admin/payments/summary?${coreQuery.toString()}`);
            if (requestToken !== state.requestToken || requestCacheKey !== getCurrentCacheKey()) {
                return false;
            }

            mergeSummaryPayload(corePayload, { sourceTab: requestedTab, replace: true });

            const coreData = state.summary;
            syncOverviewStage();
            updateToolbarHighlights(coreData);
            renderOverviewCards(coreData);
            updateOverviewBanner(coreData);
            updateOverviewLoadingMeta();
            updateLastSynced(new Date());
            void loadOverviewDeferredScopes(requestToken, requestCacheKey);
            return true;
        }

        const query = buildSummaryQuery(requestedTab);
        const payload = await fetchAdminJson(`/api/admin/payments/summary?${query.toString()}`);
        if (requestToken !== state.requestToken || requestCacheKey !== getCurrentCacheKey()) {
            return false;
        }

        mergeSummaryPayload(payload, { sourceTab: requestedTab });

        const data = state.summary;
        state.viewCache[requestedTab] = requestCacheKey;
        updateToolbarHighlights(data);
        renderRefundAlerts(data);
        renderOverviewCards(data);
        renderProviderStats(data);
        renderSitewideSummary(data);
        renderBusinessBreakdown(data);
        renderPointsBreakdown(data);
        renderTrend(data);
        renderOpsAlertQueue(data);
        renderExceptionTopics(data);
        renderAnomalies(data);
        renderCheckoutSessions(data);
        renderOrders(data);
        updateOverviewBanner(data);
        renderAnalyticsIssueSummary(data, state.workbenchContext);

        updateLastSynced(new Date());
        scheduleTabPrefetch(state.activeTab);
        return true;
    }

    async function loadCleanupPreview({ silent = false } = {}) {
        const payload = await fetchAdminJson('/api/admin/payments/cleanup');
        renderCleanupPreview(payload);
        if (!silent && typeof window.showToast === 'function') {
            window.showToast('已刷新测试数据扫描结果', 'success');
        }
    }

    async function handleAnomalyAction(targetType, targetId, action) {
        const normalizedTargetType = String(targetType || '').trim().toLowerCase();
        const normalizedTargetId = String(targetId || '').trim();
        const normalizedAction = String(action || '').trim().toLowerCase();
        if (!normalizedTargetType || !normalizedTargetId || !normalizedAction) return;

        let note = '';
        if (NOTE_REQUIRED_ACTIONS.has(normalizedAction)) {
            note = String(window.prompt(getAnomalyActionPrompt(normalizedAction), '') || '').trim();
            if (!note) {
                window.showToast?.('敏感操作必须填写处理备注。', 'warning');
                return;
            }
        }

        const actionKey = `${normalizedTargetType}:${normalizedTargetId}`;
        if (state.anomalyActionLoading[actionKey]) return;

        state.anomalyActionLoading[actionKey] = true;
        rerenderCurrentView();

        try {
            const payload = await requestAnomalyAction({
                targetType: normalizedTargetType,
                targetId: normalizedTargetId,
                action: normalizedAction,
                note: note || undefined
            });

            const successMessage = payload?.message || `${getAnomalyActionLabel(normalizedAction)}成功`;
            window.showToast?.(successMessage, 'success');
            try {
                recordPaymentsResolutionFeedback(normalizedTargetType, normalizedTargetId, normalizedAction);
            } catch (feedbackError) {
                console.warn('[AdminPayments] Failed to record resolution feedback:', feedbackError);
            }
            try {
                emitPaymentsCommandFeedback(successMessage, 'saved', { source: 'payments-ops' });
            } catch (feedbackError) {
                console.warn('[AdminPayments] Failed to emit command feedback:', feedbackError);
            }
            if (payload?.reload !== false) {
                clearTabPrefetch();
                state.viewCache = {};
                await reload();
            }
            return payload;
        } catch (error) {
            console.error('[AdminPayments] Failed to handle anomaly action:', error);
            const failureMessage = getFriendlyErrorMessage(error, '异常操作执行失败，请稍后重试。');
            window.showToast?.(failureMessage, 'error');
            emitPaymentsCommandFeedback(failureMessage, 'failed', { source: 'payments-ops' });
            throw error;
        } finally {
            delete state.anomalyActionLoading[actionKey];
            rerenderCurrentView();
        }
    }

    function requestAnomalyAction({ targetType = '', targetId = '', action = '', note } = {}) {
        return fetchAdminJson('/api/admin/payments/actions', {
            method: 'POST',
            body: JSON.stringify({
                targetType,
                targetId,
                action,
                note: note || undefined
            })
        });
    }

    function isBatchAnomalyActionLoading(scope = '', action = '') {
        const key = `${String(scope || '').trim().toLowerCase()}:${String(action || '').trim().toLowerCase()}`;
        return Boolean(state.batchAnomalyActionLoading[key]);
    }

    function getBatchAnomalyTargets(scope = '', action = '') {
        const normalizedScope = String(scope || '').trim().toLowerCase();
        const normalizedAction = String(action || '').trim().toLowerCase();

        if (normalizedScope === 'exception-topic-handled' && normalizedAction === 'archive') {
            const filteredItems = getExceptionTopicFilteredItems(state.summary || {}, state.exceptionTopicFilter);
            const split = splitItemsByResolution(filteredItems, (item) => item?.ops_status);
            const handledItems = filterItemsByStatuses(split.resolvedItems, ['handled', 'approved']);
            const uniqueTargets = new Map();

            handledItems.forEach((item) => {
                const targetType = String(item?.type || '').trim().toLowerCase();
                const targetId = String(item?.id || '').trim();
                if (!targetType || !targetId) return;
                uniqueTargets.set(`${targetType}:${targetId}`, {
                    targetType,
                    targetId
                });
            });

            return Array.from(uniqueTargets.values());
        }

        return [];
    }

    async function handleBatchAnomalyAction(scope, action) {
        const normalizedScope = String(scope || '').trim().toLowerCase();
        const normalizedAction = String(action || '').trim().toLowerCase();
        if (!normalizedScope || !normalizedAction) return;

        const targets = getBatchAnomalyTargets(normalizedScope, normalizedAction);
        if (!targets.length) {
            const emptyMessage = '当前专题下暂无可归档的已处理项。';
            window.showToast?.(emptyMessage, 'warning');
            emitPaymentsCommandFeedback(emptyMessage, 'partial', { source: 'payments-batch' });
            return;
        }

        const confirmed = window.confirm(
            `确认归档当前专题下 ${targets.length} 条已处理项吗？归档后它们不会再计入四个专题卡片数字。`
        );
        if (!confirmed) return;

        const batchKey = `${normalizedScope}:${normalizedAction}`;
        if (state.batchAnomalyActionLoading[batchKey]) return;

        state.batchAnomalyActionLoading[batchKey] = true;
        rerenderCurrentView();

        try {
            const results = await Promise.allSettled(
                targets.map((target) => requestAnomalyAction({
                    targetType: target.targetType,
                    targetId: target.targetId,
                    action: normalizedAction
                }))
            );

            const successCount = results.filter((result) => result.status === 'fulfilled').length;
            const failCount = results.length - successCount;

            if (successCount > 0) {
                clearTabPrefetch();
                state.viewCache = {};
                await reload();
            }

            if (failCount === 0) {
                const successMessage = `已批量归档 ${successCount} 条异常。`;
                window.showToast?.(successMessage, 'success');
                emitPaymentsCommandFeedback(successMessage, 'saved', { source: 'payments-batch' });
                return results;
            }

            const firstFailure = results.find((result) => result.status === 'rejected');
            const failureMessage = firstFailure?.reason
                ? getFriendlyErrorMessage(firstFailure.reason, '部分异常归档失败，请稍后重试。')
                : '部分异常归档失败，请稍后重试。';
            const resultMessage = successCount > 0
                ? `已归档 ${successCount} 条，另有 ${failCount} 条失败：${failureMessage}`
                : failureMessage;
            window.showToast?.(resultMessage, successCount > 0 ? 'warning' : 'error');
            emitPaymentsCommandFeedback(resultMessage, successCount > 0 ? 'partial' : 'failed', { source: 'payments-batch' });
            return results;
        } catch (error) {
            console.error('[AdminPayments] Failed to handle batch anomaly action:', error);
            const failureMessage = getFriendlyErrorMessage(error, '批量异常操作执行失败，请稍后重试。');
            window.showToast?.(failureMessage, 'error');
            emitPaymentsCommandFeedback(failureMessage, 'failed', { source: 'payments-batch' });
            throw error;
        } finally {
            delete state.batchAnomalyActionLoading[batchKey];
            rerenderCurrentView();
        }
    }

    function setExceptionTopicFilter(topicKey = 'all') {
        state.exceptionTopicFilter = String(topicKey || 'all').trim().toLowerCase() || 'all';
        renderExceptionTopics(state.summary || {});
    }

    async function focusExceptionTopic(topicKey = 'all') {
        const normalizedTopicKey = String(topicKey || 'all').trim().toLowerCase() || 'all';
        state.exceptionTopicFilter = normalizedTopicKey;
        switchTab('ops', { reload: false });
        if (state.initialized) {
            if (!hasCachedDataForTab('ops')) {
                await reload();
            } else {
                renderExceptionTopics(state.summary || {});
            }
        }

        const target = document.getElementById('paymentsExceptionTopics');
        if (target && typeof target.scrollIntoView === 'function') {
            window.setTimeout(() => {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 40);
        }
    }

    async function focusOpsAlertQueue() {
        switchTab('ops', { reload: false });
        if (state.initialized) {
            if (!hasCachedDataForTab('ops')) {
                await reload();
            } else {
                renderOpsAlertQueue(state.summary || {});
            }
        }

        const target = document.getElementById('paymentsOpsAlertQueuePanel');
        if (target && typeof target.scrollIntoView === 'function') {
            window.setTimeout(() => {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 40);
        }
    }

    async function init() {
        if (state.initializing && state.initPromise) {
            return state.initPromise;
        }
        state.initializing = true;
        state.initPromise = (async () => {
            showWorkbenchContext({});
            ensureRangeDefaults();
            state.autoRefreshEnabled = localStorage.getItem('paymentsAutoRefreshEnabled') !== '0';

            if (!(await ensureAdminAccess())) {
                renderAccessState('当前账号没有支付对账权限，请使用管理员账号登录后再试。', 'error');
                return;
            }

            clearAccessState();

            if (state.initialized) {
                updateRangeLabel();
                switchTab(state.activeTab, { reload: false });
                return reload();
            }

            state.initialized = true;

            if (!state.listenersBound) {
                document.addEventListener('click', (event) => {
                    if (!event.target.closest('#paymentsRangeDropdown')) {
                        closeRangeMenu();
                    }
                });
                const autoRefreshToggle = document.getElementById('paymentsAutoRefreshToggle');
                if (autoRefreshToggle) {
                    autoRefreshToggle.addEventListener('change', (event) => {
                        setAutoRefreshEnabled(Boolean(event.target.checked));
                    });
                }
                let resizeTimer = null;
                window.addEventListener('resize', () => {
                    syncTabIndicator();
                    window.clearTimeout(resizeTimer);
                    resizeTimer = window.setTimeout(() => {
                        rerenderCurrentView();
                    }, 120);
                });
                state.listenersBound = true;
            }

            updateRangeLabel();
            syncAutoRefreshToggle();
            startAutoRefresh();
            switchTab(state.activeTab, { reload: false });
            await reload();
            return true;
        })();

        try {
            return await state.initPromise;
        } finally {
            state.initializing = false;
            state.initPromise = null;
        }
    }

    async function reload() {
        if (!(await ensureAdminAccess())) {
            renderAccessState('当前账号没有支付对账权限，请使用管理员账号登录后再试。', 'error');
            return false;
        }

        const requestedTab = String(state.activeTab || 'overview').trim().toLowerCase() || 'overview';
        const requestToken = Date.now() + Math.random();
        state.requestToken = requestToken;

        try {
            clearAccessState();
            syncTabIndicator();
            if (!hasRenderedContentForTab(requestedTab)) {
                renderLoadingSkeletonForTab(requestedTab);
            } else {
                renderPaymentsToolbarHighlightsSkeleton();
            }
            setLoading(true);
            const applied = await loadSummary(requestToken, requestedTab);
            if (!applied || requestToken !== state.requestToken) {
                return null;
            }

            const currentActiveTab = String(state.activeTab || 'overview').trim().toLowerCase() || 'overview';
            if (currentActiveTab !== requestedTab) {
                if (hasCachedDataForTab(currentActiveTab)) {
                    updateToolbarHighlights(state.summary);
                    rerenderCurrentView();
                    updateOverviewBanner(state.summary);
                    renderAnalyticsIssueSummary(state.summary, state.workbenchContext);

                    if (currentActiveTab === 'ops') {
                        try {
                            await loadCleanupPreview({ silent: true });
                        } catch (cleanupError) {
                            console.error('[AdminPayments] Failed to load cleanup preview:', cleanupError);
                            renderCleanupPreviewFallback(getFriendlyErrorMessage(cleanupError, '测试数据扫描失败，但不影响支付对账查看。'));
                        }
                    }
                    return true;
                }

                return reload();
            }

            if (currentActiveTab === 'ops') {
                try {
                    await loadCleanupPreview({ silent: true });
                } catch (cleanupError) {
                    console.error('[AdminPayments] Failed to load cleanup preview:', cleanupError);
                    renderCleanupPreviewFallback(getFriendlyErrorMessage(cleanupError, '测试数据扫描失败，但不影响支付对账查看。'));
                }
            }
            return true;
        } catch (error) {
            if (requestToken !== state.requestToken) {
                return null;
            }

            console.error('[AdminPayments] Failed to load dashboard:', error);
            if (error.statusCode === 403) {
                renderAccessState(getFriendlyErrorMessage(error, '当前账号没有支付对账权限，请使用管理员账号登录后再试。'), 'error');
                return false;
            }

            if (state.summary) {
                const isOverviewPartialFailure = state.activeTab === 'overview'
                    && ['core', 'partial'].includes(String(state.overviewStage || '').trim().toLowerCase());
                renderAccessState(
                    getFriendlyErrorMessage(
                        error,
                        isOverviewPartialFailure
                            ? '支付总览首屏已加载，但部分趋势或告警刷新失败，请稍后重试。'
                            : '支付数据刷新失败，当前展示的是上一次成功结果。'
                    ),
                    'warning',
                    { preserveBody: true }
                );
                const fallbackTime = isOverviewPartialFailure
                    ? '首屏已加载，部分详情刷新失败'
                    : (state.lastSyncedAt ? `上次成功 ${formatToolbarTime(state.lastSyncedAt)}` : '刚刚刷新失败');
                setToolbarMeta(fallbackTime, 'warning');
                return false;
            }

            renderAccessState(getFriendlyErrorMessage(error, '支付对账加载失败，请稍后重试。'), 'warning');
            return false;
        } finally {
            if (requestToken === state.requestToken) {
                setLoading(false);
            }
            emitPaymentsCommandCenterSummaryUpdate();
        }
    }

    async function loadPaymentsCommandCenterPrimeSummary(options = {}) {
        const shouldForce = options.force === true;
        const cacheKey = getCurrentCacheKey();
        const hasCommandSummary = Boolean(state.summary?.overview || state.summary?.anomaly_summary);
        const hasOpsSummary = state.summary?.ops_alert_summary && typeof state.summary.ops_alert_summary === 'object';
        const taskKey = `${cacheKey}:${shouldForce ? 'force' : 'warm'}:${hasCommandSummary ? 'core-ready' : 'core-missing'}:${hasOpsSummary ? 'ops-ready' : 'ops-missing'}`;

        if (!shouldForce && hasCommandSummary && hasOpsSummary) {
            window.AdminStudioTiming?.mark?.('payments:command-prime:cache-hit', {
                cacheKey,
                hasCommandSummary,
                hasOpsSummary
            });
            return getPaymentsCommandCenterSummary();
        }

        if (!shouldForce && state.commandCenterPrimePromise && state.commandCenterPrimeKey === taskKey) {
            window.AdminStudioTiming?.mark?.('payments:command-prime:coalesced', {
                cacheKey,
                hasCommandSummary,
                hasOpsSummary
            });
            return state.commandCenterPrimePromise;
        }

        const run = async () => {
            const timingDetail = {
                cacheKey,
                force: shouldForce,
                hasCommandSummary,
                hasOpsSummary
            };
            let accessGranted = false;
            let requestCount = 0;
            let fulfilledCount = 0;
            let rejectedCount = 0;
            window.AdminStudioTiming?.mark?.('payments:command-prime:start', timingDetail);

            try {
                accessGranted = await ensureAdminAccess();
                if (!accessGranted) {
                    return getPaymentsCommandCenterSummary();
                }

                const requestCacheKey = getCurrentCacheKey();
                const requests = [];

                if (shouldForce || !hasCommandSummary) {
                    const coreQuery = buildSummaryQuery('overview', { scope: 'core', prefetch: true });
                    requests.push(
                        fetchAdminJson(`/api/admin/payments/summary?${coreQuery.toString()}`)
                            .then((payload) => {
                                if (requestCacheKey === getCurrentCacheKey()) {
                                    mergeSummaryPayload(payload, { sourceTab: 'overview', replace: !state.summary });
                                }
                            })
                    );
                }

                if (shouldForce || !hasOpsSummary) {
                    const opsQuery = buildSummaryQuery('overview', { scope: 'ops', prefetch: true });
                    requests.push(
                        fetchAdminJson(`/api/admin/payments/summary?${opsQuery.toString()}`)
                            .then((payload) => {
                                if (requestCacheKey === getCurrentCacheKey()) {
                                    mergeSummaryPayload(payload, { sourceTab: 'overview' });
                                }
                            })
                    );
                }

                requestCount = requests.length;
                const results = requests.length
                    ? await Promise.allSettled(requests)
                    : [];
                const failedResult = results.find((result) => result.status === 'rejected');
                const hasFulfilledResult = results.some((result) => result.status === 'fulfilled');
                fulfilledCount = results.filter((result) => result.status === 'fulfilled').length;
                rejectedCount = results.filter((result) => result.status === 'rejected').length;

                if (failedResult?.reason && !hasFulfilledResult && !state.summary) {
                    throw failedResult.reason;
                }

                if (failedResult?.reason) {
                    console.warn('[AdminPayments] Command center summary prime partially failed:', failedResult.reason);
                }

                if (hasFulfilledResult) {
                    state.lastSyncedAt = new Date().toISOString();
                    emitPaymentsCommandCenterSummaryUpdate();
                }

                return getPaymentsCommandCenterSummary();
            } finally {
                window.AdminStudioTiming?.mark?.('payments:command-prime:end', {
                    ...timingDetail,
                    accessGranted,
                    requestCount,
                    fulfilledCount,
                    rejectedCount
                });
                window.AdminStudioTiming?.measure?.(
                    'payments:command-prime',
                    'payments:command-prime:start',
                    'payments:command-prime:end',
                    timingDetail
                );
            }
        };

        state.commandCenterPrimeKey = taskKey;
        state.commandCenterPrimePromise = run().finally(() => {
            if (state.commandCenterPrimeKey === taskKey) {
                state.commandCenterPrimeKey = '';
                state.commandCenterPrimePromise = null;
            }
        });
        return state.commandCenterPrimePromise;
    }

    async function primePaymentsCommandCenterSummary(options = {}) {
        const shouldForce = options?.force === true;

        if (!shouldForce && state.summary?.overview && state.summary?.ops_alert_summary) {
            window.AdminStudioTiming?.mark?.('payments:command-prime:cache-hit', {
                cacheKey: getCurrentCacheKey(),
                hasCommandSummary: true,
                hasOpsSummary: true
            });
            return getPaymentsCommandCenterSummary();
        }

        return loadPaymentsCommandCenterPrimeSummary({ force: shouldForce });
    }

    async function previewCleanup() {
        try {
            setCleanupLoading(true);
            await loadCleanupPreview();
        } catch (error) {
            console.error('[AdminPayments] Failed to preview cleanup:', error);
            renderCleanupPreviewFallback(getFriendlyErrorMessage(error, '测试数据扫描失败，请稍后再试。'));
            if (typeof window.showToast === 'function') {
                window.showToast(getFriendlyErrorMessage(error, '测试数据扫描失败'), 'error');
            }
        } finally {
            setCleanupLoading(false);
        }
    }

    async function cleanupTestData() {
        if (state.cleanupLoading) return;

        const preview = state.cleanupPreview || {};
        const counts = preview.counts || {};
        const totalRows = getCleanupTotalCount(counts);
        if (!totalRows) {
            if (typeof window.showToast === 'function') {
                window.showToast('当前没有待清理的测试数据。', 'info');
            }
            return;
        }

        const confirmed = window.confirm(CLEANUP_SCOPE_TEXT);
        if (!confirmed) return;

        try {
            setCleanupLoading(true);
            const payload = await fetchAdminJson('/api/admin/payments/cleanup', {
                method: 'POST',
                body: JSON.stringify({ confirm: true })
            });

            if (typeof window.showToast === 'function') {
                window.showToast(payload.message || '测试数据已清理', payload.warnings?.length ? 'warning' : 'success');
            }
            clearTabPrefetch();
            state.viewCache = {};
            await reload();
            try {
                await loadCleanupPreview({ silent: true });
            } catch (previewError) {
                console.error('[AdminPayments] Failed to reload cleanup preview after cleanup:', previewError);
                renderCleanupPreviewFallback(getFriendlyErrorMessage(previewError, '测试数据已清理，但扫描预览暂时不可用。'));
            }
        } catch (error) {
            console.error('[AdminPayments] Failed to cleanup test data:', error);
            if (typeof window.showToast === 'function') {
                window.showToast(getFriendlyErrorMessage(error, '测试数据清理失败'), 'error');
            }
        } finally {
            setCleanupLoading(false);
        }
    }

    function applyCustomRange() {
        const startInput = document.getElementById('paymentsCustomStartDate');
        const endInput = document.getElementById('paymentsCustomEndDate');
        const startValue = String(startInput?.value || '').trim();
        const endValue = String(endInput?.value || '').trim();

        if (!startValue || !endValue) {
            window.showToast?.('请选择开始和结束日期', 'error');
            return;
        }

        const start = parseDateInput(startValue);
        const end = parseDateInput(endValue);
        if (!start || !end) {
            window.showToast?.('日期格式无效，请重新选择', 'error');
            return;
        }

        if (start.getTime() > end.getTime()) {
            window.showToast?.('开始日期不能晚于结束日期', 'error');
            return;
        }

        state.rangeMode = 'custom';
        state.customStartDate = startValue;
        state.customEndDate = endValue;
        state.days = getRangeDayDiff(startValue, endValue);
        resetViewState();
        updateRangeLabel();
        closeRangeMenu();
        if (state.initialized) {
            reload();
        }
    }

    function setDays(value, shouldCloseMenu = false) {
        const next = Number.parseInt(value, 10);
        ensureRangeDefaults();
        state.days = Number.isFinite(next) && next > 0 ? next : 30;
        state.rangeMode = 'preset';
        const presetRange = getDefaultRangeValues(state.days);
        state.customStartDate = presetRange.start;
        state.customEndDate = presetRange.end;
        resetViewState();
        updateRangeLabel();
        if (shouldCloseMenu) {
            closeRangeMenu();
        }
        if (state.initialized) {
            reload();
        }
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 500);
    }

    async function fetchExportBundle() {
        const [overviewPayload, financePayload, opsPayload] = await Promise.all([
            fetchAdminJson(`/api/admin/payments/summary?${buildSummaryQuery('overview').toString()}`),
            fetchAdminJson(`/api/admin/payments/summary?${buildSummaryQuery('finance').toString()}`),
            fetchAdminJson(`/api/admin/payments/summary?${buildSummaryQuery('ops').toString()}`)
        ]);

        return {
            exportDate: new Date().toISOString(),
            rangeLabel: getCurrentRangeLabel(),
            siteLabel: (getSiteParam() || 'all').toUpperCase(),
            overview: overviewPayload.overview || {},
            query_summary: overviewPayload.query_summary || {},
            anomaly_summary: overviewPayload.anomaly_summary || opsPayload.anomaly_summary || {},
            provider_stats: overviewPayload.provider_stats || [],
            trend_24h: overviewPayload.trend_24h || [],
            sitewide_summary: financePayload.sitewide_summary || {},
            business_breakdown: financePayload.business_breakdown || [],
            points_breakdown: financePayload.points_breakdown || [],
            ops_alert_summary: opsPayload.ops_alert_summary || overviewPayload.ops_alert_summary || {},
            ops_alert_items: opsPayload.ops_alert_items || overviewPayload.ops_alert_items || [],
            exception_topics: opsPayload.exception_topics || [],
            exception_topic_items: opsPayload.exception_topic_items || [],
            recent_anomalies: opsPayload.recent_anomalies || [],
            recent_checkout_sessions: opsPayload.recent_checkout_sessions || [],
            recent_orders: opsPayload.recent_orders || []
        };
    }

    function getShopProfitSummaryFromExportBundle(bundle = {}) {
        const sitewideSummary = normalizePaymentsContextObject(bundle.sitewide_summary);
        return normalizePaymentsContextObject(sitewideSummary.shop_profit_summary);
    }

    function buildShopProfitAuditExportRows(summary = {}) {
        if (!hasShopProfitAuditSummary(summary)) {
            return [];
        }

        const costBreakdown = normalizePaymentsContextObject(summary.cost_coverage_breakdown);
        const pointSourceCoverage = normalizePaymentsContextObject(summary.point_source_coverage);
        const adjustments = normalizePaymentsContextObject(summary.profit_adjustments);
        const alerts = normalizePaymentsContextObject(summary.shop_profit_audit_alerts);
        const adjustmentRows = (Array.isArray(adjustments.items) ? adjustments.items : [])
            .filter(Boolean)
            .map((item) => ({
                指标: `利润调整项：${item.title || item.type || '未命名'}`,
                数值: Number(item.amount_cny || 0),
                说明: [
                    item.treatment || item.description || '',
                    `${Number(item.order_count || 0)} 笔订单`,
                    Number(item.points || 0) > 0 ? `${Number(item.points || 0)} 积分` : ''
                ].filter(Boolean).join('；')
            }));

        return [
            { 指标: '订单数', 数值: Number(summary.order_count || 0), 说明: '进入净利润归因的商城订单数' },
            { 指标: '退款订单数', 数值: Number(summary.refunded_order_count || 0), 说明: '已退款订单不确认本单收入与成本' },
            { 指标: '现金确认收入 CNY', 数值: Number(summary.recognized_revenue_cny || 0), 说明: '优先按付费积分确认现金收入' },
            { 指标: '确认采购成本 CNY', 数值: Number(summary.recognized_cost_cny || 0), 说明: '按关联库存采购成本快照归因' },
            { 指标: '净利润 CNY', 数值: Number(summary.net_profit_cny || 0), 说明: '现金确认收入减确认采购成本' },
            ...adjustmentRows,
            { 指标: '毛利率', 数值: formatRatioPercent(summary.margin_rate), 说明: '净利润 / 现金确认收入' },
            { 指标: '付费积分消耗', 数值: Number(summary.paid_points_spent || 0), 说明: '订单实际扣除的付费余额' },
            { 指标: '奖励积分消耗', 数值: Number(summary.bonus_points_spent || 0), 说明: '奖励/赠送积分不直接确认为现金收入' },
            { 指标: '历史未拆分积分', 数值: Number(summary.untracked_revenue_points || 0), 说明: '历史订单缺少付费/奖励拆分，暂按旧口径估算' },
            { 指标: '积分来源需复核', 数值: Number(summary.bonus_points_spent || 0) + Number(summary.untracked_revenue_points || 0), 说明: '奖励/赠送积分和历史未拆分积分需要从现金收入口径中单独复核' },
            { 指标: '积分批次覆盖率', 数值: formatRatioPercent(pointSourceCoverage.coverage_rate || 0), 说明: '已匹配来源批次积分 / 订单实际消耗积分' },
            { 指标: '来源批次完整订单', 数值: Number(pointSourceCoverage.exact_order_count || 0), 说明: '积分来源批次完整、可直接用于现金/非现金归因的订单数' },
            { 指标: '迁移期余额积分', 数值: Number(pointSourceCoverage.migration_points || 0), 说明: '由存量余额回填产生并已参与订单消耗归因的积分' },
            { 指标: '待追踪积分', 数值: Number(pointSourceCoverage.untracked_points || 0), 说明: '尚未匹配到具体来源批次的订单消耗积分' },
            { 指标: '审计告警总数', 数值: Number(alerts.alert_count || 0), 说明: '商城利润审计产生的可处理告警数量' },
            { 指标: '审计告警待处理', 数值: Number(alerts.action_required_count || 0), 说明: '需要管理员复核或补齐数据的告警数量' },
            { 指标: '审计告警红色', 数值: Number(alerts.critical_count || 0), 说明: '负利润等高优先级告警数量' },
            { 指标: '审计告警黄色', 数值: Number(alerts.warning_count || 0), 说明: '缺成本、来源未闭环、分录未完整等告警数量' },
            { 指标: '库存件数', 数值: Number(summary.inventory_item_count || 0), 说明: '订单关联库存总件数' },
            { 指标: '已成本化库存', 数值: Number(summary.costed_item_count || 0), 说明: '有采购成本快照的库存件数' },
            { 指标: '缺成本库存', 数值: Number(summary.missing_cost_item_count || 0), 说明: '缺少采购成本会高估净利润' },
            { 指标: '成本覆盖率', 数值: formatRatioPercent(summary.cost_coverage_rate || 0), 说明: '已成本化库存 / 订单关联库存' },
            { 指标: '完整成本订单', 数值: Number(costBreakdown.complete || 0), 说明: '关联库存都有采购成本' },
            { 指标: '部分成本订单', 数值: Number(costBreakdown.partial || 0), 说明: '部分关联库存缺少采购成本' },
            { 指标: '无成本订单', 数值: Number(costBreakdown.no_cost || 0), 说明: '关联库存均缺采购成本' },
            { 指标: '未关联库存订单', 数值: Number(costBreakdown.no_inventory || 0), 说明: '无法归因库存成本' }
        ];
    }

    function buildShopProfitReadinessExportRows(summary = {}) {
        if (!hasShopProfitAuditSummary(summary)) {
            return [];
        }

        const readiness = normalizePaymentsContextObject(summary.profit_readiness);
        const rows = [{
            项目: '结算就绪度',
            状态: readiness.label || '',
            分数: Number(readiness.score || 0),
            待处理: Number(readiness.action_required_count || 0),
            阻断项: Number(readiness.blocker_count || 0),
            警告项: Number(readiness.warning_count || 0),
            是否可结算: readiness.settlement_ready ? '是' : '否',
            处理建议: readiness.settlement_ready ? '可进入结算口径' : '先处理待处理项'
        }];

        return rows.concat((Array.isArray(readiness.items) ? readiness.items : [])
            .filter(Boolean)
            .map((item) => ({
                项目: item.label || '',
                状态: getSeverityLabel(item.severity || item.status || 'info'),
                分数: '',
                待处理: item.action_required ? 1 : 0,
                阻断项: String(item.severity || '').toLowerCase() === 'critical' ? 1 : 0,
                警告项: String(item.severity || '').toLowerCase() === 'warning' ? 1 : 0,
                是否可结算: item.action_required ? '否' : '是',
                处理建议: item.action_label || item.description || ''
            })));
    }

    function buildShopProfitDimensionExportRows(summary = {}) {
        if (!hasShopProfitAuditSummary(summary)) {
            return [];
        }

        const breakdown = normalizePaymentsContextObject(summary.dimension_breakdown);
        const groups = [
            { label: '商品', rows: Array.isArray(breakdown.products) ? breakdown.products : [] },
            { label: '规格', rows: Array.isArray(breakdown.skus) ? breakdown.skus : [] },
            { label: '货源批次', rows: Array.isArray(breakdown.source_batches) ? breakdown.source_batches : [] }
        ];

        return groups.flatMap((group) => group.rows.map((row) => ({
            维度: group.label,
            名称: row.label || '',
            风险: row.risk_label || '',
            订单数: Number(row.order_count || 0),
            退款订单: Number(row.refunded_order_count || 0),
            负利润订单: Number(row.negative_profit_order_count || 0),
            缺成本订单: Number(row.missing_cost_order_count || 0),
            未关联库存订单: Number(row.no_inventory_order_count || 0),
            库存件数: Number(row.inventory_item_count || 0),
            缺成本库存: Number(row.missing_cost_item_count || 0),
            现金收入CNY: Number(row.recognized_revenue_cny || 0),
            采购成本CNY: Number(row.recognized_cost_cny || 0),
            净利润CNY: Number(row.net_profit_cny || 0),
            毛利率: formatRatioPercent(row.margin_rate),
            成本覆盖率: formatRatioPercent(row.cost_coverage_rate || 0),
            积分来源需复核: Number(row.bonus_points_spent || 0) + Number(row.untracked_revenue_points || 0)
        })));
    }

    function buildShopProfitSourceExportRows(summary = {}) {
        if (!hasShopProfitAuditSummary(summary)) {
            return [];
        }

        const breakdown = normalizePaymentsContextObject(summary.dimension_breakdown);
        return (Array.isArray(breakdown.sources) ? breakdown.sources : [])
            .filter(Boolean)
            .map((row) => ({
                货源: row.source_name || row.label || '',
                平台: row.source_platform || '',
                风险等级: row.source_risk_tier || '',
                质量等级: row.source_quality_grade || '',
                建议: row.procurement_suggestion || '',
                风险: row.risk_label || '',
                订单数: Number(row.order_count || 0),
                退款订单: Number(row.refunded_order_count || 0),
                负利润订单: Number(row.negative_profit_order_count || 0),
                缺成本订单: Number(row.missing_cost_order_count || 0),
                库存件数: Number(row.inventory_item_count || 0),
                缺成本库存: Number(row.missing_cost_item_count || 0),
                现金收入CNY: Number(row.recognized_revenue_cny || 0),
                采购成本CNY: Number(row.recognized_cost_cny || 0),
                净利润CNY: Number(row.net_profit_cny || 0),
                毛利率: formatRatioPercent(row.margin_rate),
                成本覆盖率: formatRatioPercent(row.cost_coverage_rate || 0)
            }));
    }

    function buildShopProcurementRecommendationExportRows(summary = {}) {
        if (!hasShopProfitAuditSummary(summary)) {
            return [];
        }

        const recommendations = normalizePaymentsContextObject(summary.source_procurement_recommendations);
        return (Array.isArray(recommendations.items) ? recommendations.items : [])
            .filter(Boolean)
            .map((item) => ({
                货源: item.source_name || '',
                平台: item.source_platform || '',
                风险等级: item.source_risk_tier || '',
                质量等级: item.source_quality_grade || '',
                动作: getShopProcurementRecommendationActionLabel(item.action_type),
                原因: item.reason_label || '',
                处理建议: item.action_label || '',
                风险级别: getSeverityLabel(item.severity || 'review'),
                订单数: Number(item.order_count || 0),
                退款订单: Number(item.refunded_order_count || 0),
                负利润订单: Number(item.negative_profit_order_count || 0),
                缺成本订单: Number(item.missing_cost_order_count || 0),
                未关联库存订单: Number(item.no_inventory_order_count || 0),
                库存件数: Number(item.inventory_item_count || 0),
                缺成本库存: Number(item.missing_cost_item_count || 0),
                现金收入CNY: Number(item.recognized_revenue_cny || 0),
                采购成本CNY: Number(item.recognized_cost_cny || 0),
                净利润CNY: Number(item.net_profit_cny || 0),
                毛利率: formatRatioPercent(item.margin_rate),
                成本覆盖率: formatRatioPercent(item.cost_coverage_rate || 0),
                退款率: formatRatioPercent(item.refund_rate || 0)
            }));
    }

    function buildShopProfitLedgerPreviewExportRows(summary = {}) {
        if (!hasShopProfitAuditSummary(summary)) {
            return [];
        }

        const preview = normalizePaymentsContextObject(summary.profit_ledger_preview);
        return (Array.isArray(preview.entries_by_type) ? preview.entries_by_type : [])
            .filter(Boolean)
            .map((entry) => ({
                分录类型: entry.title || entry.type || '',
                分组: entry.group || '',
                状态: getShopProfitLedgerStatusLabel(entry.status),
                分录数: Number(entry.entry_count || 0),
                订单数: Number(entry.order_count || 0),
                金额CNY: Number(entry.amount_cny || 0),
                积分数: Number(entry.points_amount || 0)
            }));
    }

    function buildShopProfitClosureExportRows(summary = {}) {
        if (!hasShopProfitAuditSummary(summary)) {
            return [];
        }

        const closure = normalizePaymentsContextObject(summary.profit_reconciliation_closure);
        return (Array.isArray(closure.items) ? closure.items : [])
            .filter(Boolean)
            .map((item) => ({
                链路: getShopProfitClosureCategoryLabel(item.category),
                对账项: item.label || '',
                状态: getShopProfitClosureStatusLabel(item.status),
                指标: item.value_label || '',
                待处理: item.action_required ? '是' : '否',
                订单数: Number(item.order_count || 0),
                金额CNY: Number(item.amount_cny || 0),
                积分数: Number(item.points || 0),
                处理建议: item.action_label || '',
                说明: item.description || ''
            }));
    }

    function buildShopProfitAdjustmentBreakdownExportRows(summary = {}) {
        if (!hasShopProfitAuditSummary(summary)) {
            return [];
        }

        const breakdown = normalizePaymentsContextObject(summary.profit_adjustment_breakdown);
        return (Array.isArray(breakdown.items) ? breakdown.items : [])
            .filter(Boolean)
            .map((item) => ({
                影响项: item.label || item.title || '',
                类型: item.type || '',
                分类: item.category || '',
                状态: getShopProfitAdjustmentClosureLabel(item.closure_status),
                是否待处理: item.action_required ? '是' : '否',
                订单数: Number(item.order_count || 0),
                金额CNY: Number(item.amount_cny || 0),
                积分数: Number(item.points || 0),
                是否影响净利润: item.affects_net_profit ? '是' : '否',
                处理口径: item.net_profit_treatment || ''
            }));
    }

    function buildShopProfitOrderRiskExportRows(summary = {}) {
        if (!hasShopProfitAuditSummary(summary)) {
            return [];
        }

        const riskList = normalizePaymentsContextObject(summary.order_risk_list);
        return (Array.isArray(riskList.items) ? riskList.items : [])
            .filter(Boolean)
            .map((item) => ({
                订单号: item.order_no || item.order_id || '',
                商品: item.product_name || '',
                风险级别: getShopProfitOrderRiskStatusLabel(item),
                风险原因: (Array.isArray(item.reasons) ? item.reasons : [])
                    .map((reason) => reason.label || reason.type || '')
                    .filter(Boolean)
                    .join('；'),
                现金收入CNY: Number(item.recognized_revenue_cny || 0),
                采购成本CNY: Number(item.recognized_cost_cny || 0),
                净利润CNY: Number(item.net_profit_cny || 0),
                缺成本件数: Number(item.missing_cost_item_count || 0),
                付费积分: Number(item.paid_points_spent || 0),
                非现金积分: Number(item.bonus_points_spent || 0),
                待追踪积分: Number(item.untracked_revenue_points || 0),
                积分来源状态: item.point_source_traceability_label || '',
                处理建议: item.action_label || '',
                创建时间: item.created_at || ''
            }));
    }

    function exportAsCSV(bundle) {
        let csv = '';
        csv += '=== 支付对账概览 ===\n';
        csv += `导出时间,${bundle.exportDate}\n`;
        csv += `站点,${bundle.siteLabel}\n`;
        csv += `筛选范围,${bundle.rangeLabel}\n`;
        csv += `总订单,${bundle.overview.total_orders || 0}\n`;
        csv += `支付成功率,${bundle.overview.paid_rate || 0}%\n`;
        csv += `认领率,${bundle.overview.claim_rate || 0}%\n`;
        csv += `支付金额,${bundle.overview.total_amount || 0}\n\n`;

        csv += '=== 通道表现 ===\n';
        csv += '通道,总订单,支付成功,认领率,金额,积分\n';
        (bundle.provider_stats || []).forEach((item) => {
            csv += `${item.provider || ''},${item.total_orders || 0},${item.paid_rate || 0}%,${item.claim_rate || 0}%,${item.total_amount || 0},${item.total_points || 0}\n`;
        });
        csv += '\n=== 全站收支 ===\n';
        csv += '指标,数值,说明\n';
        (bundle.business_breakdown || []).forEach((item) => {
            csv += `${(item.title || '').replace(/,/g, '，')},${(item.metric || '').replace(/,/g, '，')},${(item.meta || '').replace(/,/g, '，')}\n`;
        });
        const shopProfitAuditRows = buildShopProfitAuditExportRows(getShopProfitSummaryFromExportBundle(bundle));
        if (shopProfitAuditRows.length) {
            csv += '\n=== 商城净利润审计 ===\n';
            csv += '指标,数值,说明\n';
            shopProfitAuditRows.forEach((row) => {
                csv += `${String(row.指标 || '').replace(/,/g, '，')},${String(row.数值 ?? '').replace(/,/g, '，')},${String(row.说明 || '').replace(/,/g, '，')}\n`;
            });
        }
        const shopProfitReadinessRows = buildShopProfitReadinessExportRows(getShopProfitSummaryFromExportBundle(bundle));
        if (shopProfitReadinessRows.length) {
            csv += '\n=== 商城结算就绪度 ===\n';
            csv += '项目,状态,分数,待处理,阻断项,警告项,是否可结算,处理建议\n';
            shopProfitReadinessRows.forEach((row) => {
                csv += [
                    row.项目,
                    row.状态,
                    row.分数,
                    row.待处理,
                    row.阻断项,
                    row.警告项,
                    row.是否可结算,
                    row.处理建议
                ].map((value) => String(value ?? '').replace(/,/g, '，')).join(',');
                csv += '\n';
            });
        }
        const shopProfitLedgerRows = buildShopProfitLedgerPreviewExportRows(getShopProfitSummaryFromExportBundle(bundle));
        if (shopProfitLedgerRows.length) {
            csv += '\n=== 商城利润分录预览 ===\n';
            csv += '分录类型,分组,状态,分录数,订单数,金额CNY,积分数\n';
            shopProfitLedgerRows.forEach((row) => {
                csv += [
                    row.分录类型,
                    row.分组,
                    row.状态,
                    row.分录数,
                    row.订单数,
                    row.金额CNY,
                    row.积分数
                ].map((value) => String(value ?? '').replace(/,/g, '，')).join(',');
                csv += '\n';
            });
        }
        const shopProfitClosureRows = buildShopProfitClosureExportRows(getShopProfitSummaryFromExportBundle(bundle));
        if (shopProfitClosureRows.length) {
            csv += '\n=== 商城对账闭环 ===\n';
            csv += '链路,对账项,状态,指标,待处理,订单数,金额CNY,积分数,处理建议,说明\n';
            shopProfitClosureRows.forEach((row) => {
                csv += [
                    row.链路,
                    row.对账项,
                    row.状态,
                    row.指标,
                    row.待处理,
                    row.订单数,
                    row.金额CNY,
                    row.积分数,
                    row.处理建议,
                    row.说明
                ].map((value) => String(value ?? '').replace(/,/g, '，')).join(',');
                csv += '\n';
            });
        }
        const shopProfitAdjustmentBreakdownRows = buildShopProfitAdjustmentBreakdownExportRows(getShopProfitSummaryFromExportBundle(bundle));
        if (shopProfitAdjustmentBreakdownRows.length) {
            csv += '\n=== 商城利润影响构成 ===\n';
            csv += '影响项,类型,分类,状态,是否待处理,订单数,金额CNY,积分数,是否影响净利润,处理口径\n';
            shopProfitAdjustmentBreakdownRows.forEach((row) => {
                csv += [
                    row.影响项,
                    row.类型,
                    row.分类,
                    row.状态,
                    row.是否待处理,
                    row.订单数,
                    row.金额CNY,
                    row.积分数,
                    row.是否影响净利润,
                    row.处理口径
                ].map((value) => String(value ?? '').replace(/,/g, '，')).join(',');
                csv += '\n';
            });
        }
        const shopProfitOrderRiskRows = buildShopProfitOrderRiskExportRows(getShopProfitSummaryFromExportBundle(bundle));
        if (shopProfitOrderRiskRows.length) {
            csv += '\n=== 商城风险订单 ===\n';
            csv += '订单号,商品,风险级别,风险原因,现金收入CNY,采购成本CNY,净利润CNY,缺成本件数,付费积分,非现金积分,待追踪积分,积分来源状态,处理建议,创建时间\n';
            shopProfitOrderRiskRows.forEach((row) => {
                csv += [
                    row.订单号,
                    row.商品,
                    row.风险级别,
                    row.风险原因,
                    row.现金收入CNY,
                    row.采购成本CNY,
                    row.净利润CNY,
                    row.缺成本件数,
                    row.付费积分,
                    row.非现金积分,
                    row.待追踪积分,
                    row.积分来源状态,
                    row.处理建议,
                    row.创建时间
                ].map((value) => String(value ?? '').replace(/,/g, '，')).join(',');
                csv += '\n';
            });
        }
        const shopProfitSourceRows = buildShopProfitSourceExportRows(getShopProfitSummaryFromExportBundle(bundle));
        const shopProcurementRecommendationRows = buildShopProcurementRecommendationExportRows(getShopProfitSummaryFromExportBundle(bundle));
        if (shopProcurementRecommendationRows.length) {
            csv += '\n=== 商城采购建议 ===\n';
            csv += '货源,平台,风险等级,质量等级,动作,原因,处理建议,风险级别,订单数,退款订单,负利润订单,缺成本订单,未关联库存订单,库存件数,缺成本库存,现金收入CNY,采购成本CNY,净利润CNY,毛利率,成本覆盖率,退款率\n';
            shopProcurementRecommendationRows.forEach((row) => {
                csv += [
                    row.货源,
                    row.平台,
                    row.风险等级,
                    row.质量等级,
                    row.动作,
                    row.原因,
                    row.处理建议,
                    row.风险级别,
                    row.订单数,
                    row.退款订单,
                    row.负利润订单,
                    row.缺成本订单,
                    row.未关联库存订单,
                    row.库存件数,
                    row.缺成本库存,
                    row.现金收入CNY,
                    row.采购成本CNY,
                    row.净利润CNY,
                    row.毛利率,
                    row.成本覆盖率,
                    row.退款率
                ].map((value) => String(value ?? '').replace(/,/g, '，')).join(',');
                csv += '\n';
            });
        }
        if (shopProfitSourceRows.length) {
            csv += '\n=== 商城货源利润 ===\n';
            csv += '货源,平台,风险等级,质量等级,建议,风险,订单数,退款订单,负利润订单,缺成本订单,库存件数,缺成本库存,现金收入CNY,采购成本CNY,净利润CNY,毛利率,成本覆盖率\n';
            shopProfitSourceRows.forEach((row) => {
                csv += [
                    row.货源,
                    row.平台,
                    row.风险等级,
                    row.质量等级,
                    row.建议,
                    row.风险,
                    row.订单数,
                    row.退款订单,
                    row.负利润订单,
                    row.缺成本订单,
                    row.库存件数,
                    row.缺成本库存,
                    row.现金收入CNY,
                    row.采购成本CNY,
                    row.净利润CNY,
                    row.毛利率,
                    row.成本覆盖率
                ].map((value) => String(value ?? '').replace(/,/g, '，')).join(',');
                csv += '\n';
            });
        }
        const shopProfitDimensionRows = buildShopProfitDimensionExportRows(getShopProfitSummaryFromExportBundle(bundle));
        if (shopProfitDimensionRows.length) {
            csv += '\n=== 商城利润维度 ===\n';
            csv += '维度,名称,风险,订单数,退款订单,负利润订单,缺成本订单,未关联库存订单,库存件数,缺成本库存,现金收入CNY,采购成本CNY,净利润CNY,毛利率,成本覆盖率,积分来源需复核\n';
            shopProfitDimensionRows.forEach((row) => {
                csv += [
                    row.维度,
                    row.名称,
                    row.风险,
                    row.订单数,
                    row.退款订单,
                    row.负利润订单,
                    row.缺成本订单,
                    row.未关联库存订单,
                    row.库存件数,
                    row.缺成本库存,
                    row.现金收入CNY,
                    row.采购成本CNY,
                    row.净利润CNY,
                    row.毛利率,
                    row.成本覆盖率,
                    row.积分来源需复核
                ].map((value) => String(value ?? '').replace(/,/g, '，')).join(',');
                csv += '\n';
            });
        }
        csv += '\n=== 积分流水分类 ===\n';
        csv += '分类,流入,流出,净值\n';
        (bundle.points_breakdown || []).forEach((item) => {
            csv += `${(item.label || '').replace(/,/g, '，')},${item.inflow || 0},${item.outflow || 0},${item.net || 0}\n`;
        });
        csv += '\n=== 异常队列 ===\n';
        csv += '标题,严重级别,通道,发起人邮箱,订单号/会话,时间\n';
        (bundle.recent_anomalies || []).forEach((item) => {
            const initiatorEmail = String(item?.type || '').trim().toLowerCase() === 'session'
                ? (String(item.user_email || '').trim() || getPaymentInitiatorEmailLabel(item))
                : String(item.user_email || '').trim();
            csv += `${(item.title || '').replace(/,/g, '，')},${getSeverityLabel(item.severity)},${getProviderLabel(item.provider)},${initiatorEmail.replace(/,/g, '，')},${getAnomalyReferenceValue(item).replace(/,/g, '，')},${formatDateTime(item.created_at)}\n`;
        });
        csv += '\n=== 最近支付意图会话 ===\n';
        csv += '发起人邮箱,通道,套餐,会话Key,参考单号,站点,应付金额,到账积分,状态,匹配状态,创建时间\n';
        (bundle.recent_checkout_sessions || []).forEach((item) => {
            const matchInfo = getCheckoutSessionTraceMatchInfo(item);
            csv += `${(item.user_email || '').replace(/,/g, '，')},${getProviderLabel(item.provider)},${(item.package_name || '').replace(/,/g, '，')},${(item.session_key || '').replace(/,/g, '，')},${(item.provider_order_no || '').replace(/,/g, '，')},${String(item.site || 'cn').toUpperCase()},${item.expected_amount || 0},${item.granted_points || 0},${getSessionStatusLabel(item.status)},${matchInfo.label},${formatDateTime(item.created_at)}\n`;
        });
        csv += '\n=== 最近订单 ===\n';
        csv += '用户邮箱,订单号,通道,套餐,金额,积分,状态,创建时间\n';
        (bundle.recent_orders || []).forEach((item) => {
            csv += `${(item.user_email || '').replace(/,/g, '，')},${(item.provider_order_no || '').replace(/,/g, '，')},${getProviderLabel(item.provider)},${(item.package_name || '').replace(/,/g, '，')},${formatPaymentOrderAmount(item).replace(/,/g, '，')},${item.points_amount || 0},${getStatusLabel(item.status)},${formatDateTime(item.created_at)}\n`;
        });

        downloadBlob(
            new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }),
            `payments_${new Date().toISOString().split('T')[0]}.csv`
        );
    }

    function exportAsExcel(bundle) {
        if (typeof XLSX === 'undefined') {
            throw new Error('Excel 导出组件未加载，请刷新后重试');
        }

        const wb = XLSX.utils.book_new();
        const overviewSheet = XLSX.utils.json_to_sheet([{
            导出时间: bundle.exportDate,
            站点: bundle.siteLabel,
            筛选范围: bundle.rangeLabel,
            总订单: bundle.overview.total_orders || 0,
            支付成功率: bundle.overview.paid_rate || 0,
            认领率: bundle.overview.claim_rate || 0,
            支付金额: bundle.overview.total_amount || 0,
            支付积分: bundle.overview.total_points || 0
        }]);
        XLSX.utils.book_append_sheet(wb, overviewSheet, '支付概览');

        if ((bundle.provider_stats || []).length) {
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((bundle.provider_stats || []).map((item) => ({
                通道: getProviderLabel(item.provider),
                总订单: item.total_orders || 0,
                支付成功率: item.paid_rate || 0,
                认领率: item.claim_rate || 0,
                金额: item.total_amount || 0,
                积分: item.total_points || 0
            }))), '通道表现');
        }

        if ((bundle.business_breakdown || []).length) {
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((bundle.business_breakdown || []).map((item) => ({
                分类: item.title,
                指标: item.metric,
                说明: item.description,
                补充: item.meta
            }))), '全站收支');
        }

        const shopProfitAuditRows = buildShopProfitAuditExportRows(getShopProfitSummaryFromExportBundle(bundle));
        if (shopProfitAuditRows.length) {
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(shopProfitAuditRows), '商城净利润审计');
        }
        const shopProfitReadinessRows = buildShopProfitReadinessExportRows(getShopProfitSummaryFromExportBundle(bundle));
        if (shopProfitReadinessRows.length) {
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(shopProfitReadinessRows), '商城结算就绪度');
        }
        const shopProfitLedgerRows = buildShopProfitLedgerPreviewExportRows(getShopProfitSummaryFromExportBundle(bundle));
        if (shopProfitLedgerRows.length) {
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(shopProfitLedgerRows), '商城利润分录');
        }
        const shopProfitClosureRows = buildShopProfitClosureExportRows(getShopProfitSummaryFromExportBundle(bundle));
        if (shopProfitClosureRows.length) {
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(shopProfitClosureRows), '商城对账闭环');
        }
        const shopProfitAdjustmentBreakdownRows = buildShopProfitAdjustmentBreakdownExportRows(getShopProfitSummaryFromExportBundle(bundle));
        if (shopProfitAdjustmentBreakdownRows.length) {
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(shopProfitAdjustmentBreakdownRows), '商城利润影响构成');
        }
        const shopProfitOrderRiskRows = buildShopProfitOrderRiskExportRows(getShopProfitSummaryFromExportBundle(bundle));
        if (shopProfitOrderRiskRows.length) {
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(shopProfitOrderRiskRows), '商城风险订单');
        }
        const shopProfitSourceRows = buildShopProfitSourceExportRows(getShopProfitSummaryFromExportBundle(bundle));
        const shopProcurementRecommendationRows = buildShopProcurementRecommendationExportRows(getShopProfitSummaryFromExportBundle(bundle));
        if (shopProcurementRecommendationRows.length) {
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(shopProcurementRecommendationRows), '商城采购建议');
        }
        if (shopProfitSourceRows.length) {
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(shopProfitSourceRows), '商城货源利润');
        }
        const shopProfitDimensionRows = buildShopProfitDimensionExportRows(getShopProfitSummaryFromExportBundle(bundle));
        if (shopProfitDimensionRows.length) {
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(shopProfitDimensionRows), '商城利润维度');
        }

        if ((bundle.points_breakdown || []).length) {
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((bundle.points_breakdown || []).map((item) => ({
                分类: item.label,
                流入: item.inflow || 0,
                流出: item.outflow || 0,
                净值: item.net || 0
            }))), '积分流水');
        }

        if ((bundle.recent_anomalies || []).length) {
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((bundle.recent_anomalies || []).map((item) => ({
                标题: item.title,
                严重级别: getSeverityLabel(item.severity),
                通道: getProviderLabel(item.provider),
                发起人邮箱: String(item?.type || '').trim().toLowerCase() === 'session'
                    ? (String(item.user_email || '').trim() || getPaymentInitiatorEmailLabel(item))
                    : String(item.user_email || '').trim(),
                订单号或会话: getAnomalyReferenceValue(item),
                时间: formatDateTime(item.created_at),
                描述: item.message || ''
            }))), '异常队列');
        }

        if ((bundle.recent_checkout_sessions || []).length) {
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((bundle.recent_checkout_sessions || []).map((item) => {
                const matchInfo = getCheckoutSessionTraceMatchInfo(item);
                return {
                    发起人邮箱: item.user_email || '',
                    通道: getProviderLabel(item.provider),
                    套餐: item.package_name || '',
                    会话Key: item.session_key || '',
                    参考单号: item.provider_order_no || '',
                    站点: String(item.site || 'cn').toUpperCase(),
                    应付金额: item.expected_amount || 0,
                    到账积分: item.granted_points || 0,
                    状态: getSessionStatusLabel(item.status),
                    匹配状态: matchInfo.label,
                    创建时间: formatDateTime(item.created_at),
                    说明: getCheckoutSessionTraceDetail(item)
                };
            })), '支付意图会话');
        }

        if ((bundle.recent_orders || []).length) {
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((bundle.recent_orders || []).map((item) => ({
                用户邮箱: item.user_email || '',
                订单号: item.provider_order_no || '',
                通道: getProviderLabel(item.provider),
                套餐: item.package_name || '',
                金额: formatPaymentOrderAmount(item),
                积分: item.points_amount || 0,
                状态: getStatusLabel(item.status),
                创建时间: formatDateTime(item.created_at)
            }))), '最近订单');
        }

        XLSX.writeFile(wb, `payments_${new Date().toISOString().split('T')[0]}.xlsx`);
    }

    async function exportData(format) {
        try {
            const payload = await fetchExportBundle();
            if (format === 'csv') {
                exportAsCSV(payload);
            } else {
                exportAsExcel(payload);
            }
            window.showToast?.(`${String(format).toUpperCase()} 导出成功`, 'success');
            return true;
        } catch (error) {
            console.error('[AdminPayments] Failed to export data:', error);
            window.showToast?.(getFriendlyErrorMessage(error, '支付对账导出失败，请稍后重试。'), 'error');
            return false;
        }
    }

    function goToPage(pageKey, page) {
        const next = Number.parseInt(page, 10);
        if (!Number.isFinite(next) || next < 1) return;
        state.pagination[pageKey] = next;

        if (pageKey === 'cleanupOrders' || pageKey === 'cleanupUsers') {
            renderCleanupPreview({ preview: state.cleanupPreview });
            return;
        }

        if (!state.summary) return;
        if (pageKey === 'anomalies') {
            renderAnomalies(state.summary);
            return;
        }
        if (pageKey === 'sessions') {
            renderCheckoutSessions(state.summary);
            return;
        }
        if (pageKey === 'orders') {
            renderOrders(state.summary);
        }
    }

    async function focusOrder(orderId, options = {}) {
        const normalizedOrderId = String(orderId || '').trim();
        if (!normalizedOrderId) {
            state.lastFocusResult = { opened: false, matched: false };
            return { ...state.lastFocusResult };
        }

        state.focusOrderId = normalizedOrderId;
        const focusTab = normalizePaymentsTabId(options.focusTab || options.tab || 'ops');
        const needsFocusedTabData = focusTab === 'ops' && !hasCachedDataForTab('ops');

        if (options.switchTab !== false) {
            switchTab(focusTab, { reload: false });
        }

        if (options.reload !== false || !state.summary || needsFocusedTabData) {
            await reload();
        } else if (state.summary) {
            renderOrders(state.summary);
        }

        const matched = getFocusedOrderIndex(state.summary?.recent_orders || [], normalizedOrderId) >= 0;
        if (matched) {
            scrollFocusedOrderIntoView();
        }
        state.lastFocusResult = { opened: true, matched };
        renderAnalyticsIssueSummary(state.summary, state.workbenchContext);
        return { ...state.lastFocusResult };
    }

    function resolvePaymentsActivationTab(context = {}, options = {}) {
        const normalizedContext = normalizePaymentsContextObject(context);
        const payload = normalizePaymentsContextObject(normalizedContext.payload);
        const raw = normalizePaymentsContextObject(normalizedContext.raw);
        const focusTargetId = String(
            payload.focusTargetId
            || payload.focus_target_id
            || raw.focusTargetId
            || raw.focus_target_id
            || normalizedContext.focusTargetId
            || normalizedContext.focus_target_id
            || ''
        ).trim();

        if (focusTargetId === 'paymentsExceptionTopics') {
            return 'ops';
        }

        return normalizePaymentsTabId(
            payload.defaultTab
            || payload.tab
            || raw.defaultTab
            || raw.tab
            || options.defaultTab
            || options.tab
            || state.activeTab
            || 'overview'
        );
    }

    function scrollPaymentsFocusTarget(targetId = '') {
        const normalizedTargetId = String(targetId || '').trim();
        if (!normalizedTargetId) {
            return false;
        }

        const target = document.getElementById(normalizedTargetId);
        if (!target || typeof target.scrollIntoView !== 'function') {
            return false;
        }

        window.setTimeout(() => {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 40);
        return true;
    }

    async function ensureVisiblePaymentsContent(reason = '') {
        if (!isPaymentsModuleActive() || !state.initialized) {
            return false;
        }

        const activeTab = String(state.activeTab || 'overview').trim().toLowerCase() || 'overview';
        if (hasRenderedContentForTab(activeTab)) {
            return true;
        }

        if (state.loading) {
            renderLoadingSkeletonForTab(activeTab);
            return false;
        }

        setToolbarMeta('正在载入支付数据…', 'info');
        window.AdminStudioTiming?.mark?.('payments:activation-empty-shell-reload', {
            tab: activeTab,
            reason: String(reason || 'activate')
        });
        return reload();
    }

    async function activatePaymentsModule(context = {}, options = {}) {
        const nextTab = resolvePaymentsActivationTab(context, options);
        switchTab(nextTab, { reload: false });
        await init();
        await ensureVisiblePaymentsContent(options?.reason || context?.reason || 'activate');
        return true;
    }

    async function handlePaymentsModuleContext(context = {}, options = {}) {
        const normalizedContext = normalizePaymentsContextObject(context);
        const focus = normalizePaymentsContextObject(normalizedContext.focus);
        const payload = normalizePaymentsContextObject(normalizedContext.payload);
        const raw = normalizePaymentsContextObject(normalizedContext.raw);
        const paymentOrderId = String(
            focus.paymentOrderId
            || focus.payment_order_id
            || payload.paymentOrderId
            || payload.payment_order_id
            || raw.paymentOrderId
            || raw.payment_order_id
            || ''
        ).trim();
        const issueSummaryKind = String(
            payload.issueSummary
            || payload.issue_summary
            || raw.issueSummary
            || raw.issue_summary
            || ''
        ).trim().toLowerCase();
        const priorityAction = String(
            payload.priorityAction
            || payload.priority_action
            || raw.priorityAction
            || raw.priority_action
            || normalizedContext.priorityAction
            || normalizedContext.priority_action
            || ''
        ).trim().toLowerCase();
        const exceptionTopic = String(
            payload.exceptionTopic
            || payload.exception_topic
            || raw.exceptionTopic
            || raw.exception_topic
            || ''
        ).trim();
        const focusTargetId = String(
            payload.focusTargetId
            || payload.focus_target_id
            || raw.focusTargetId
            || raw.focus_target_id
            || normalizedContext.focusTargetId
            || normalizedContext.focus_target_id
            || ''
        ).trim();

        showWorkbenchContext(normalizedContext);

        if (
            (priorityAction === 'order' && paymentOrderId)
            || (priorityAction === 'topic' && exceptionTopic)
            || priorityAction === 'ops'
        ) {
            const focusResult = await focusAnalyticsPrioritySummary(
                priorityAction,
                priorityAction === 'order'
                    ? paymentOrderId
                    : (priorityAction === 'topic' ? exceptionTopic : '')
            );

            if (priorityAction === 'order' && paymentOrderId) {
                emitPaymentsOrderFocusResult(paymentOrderId, focusResult);
            } else {
                const priorityMessage = getPaymentsPriorityFocusMessage(priorityAction, exceptionTopic);
                if (priorityMessage) {
                    emitPaymentsCommandFeedback(priorityMessage, 'saved', { source: 'payments-focus' });
                }
            }

            if (focusTargetId) {
                scrollPaymentsFocusTarget(focusTargetId);
            }
            return true;
        }

        if (paymentOrderId) {
            const focusResult = await focusOrder(paymentOrderId, {
                switchTab: true,
                reload: !state.summary || options.force === true
            });
            emitPaymentsOrderFocusResult(paymentOrderId, focusResult);

            if (!focusResult.matched && focusTargetId) {
                scrollPaymentsFocusTarget(focusTargetId);
            }
            return true;
        }

        if (issueSummaryKind) {
            await focusAnalyticsIssueSummary(issueSummaryKind);
            emitPaymentsCommandFeedback(getPaymentsIssueSummaryFocusMessage(issueSummaryKind), 'saved', {
                source: 'payments-focus'
            });
            return true;
        }

        if (exceptionTopic) {
            await focusExceptionTopic(exceptionTopic);
            emitPaymentsCommandFeedback(`支付异常主题 ${exceptionTopic} 已定位`, 'saved', {
                source: 'payments-focus'
            });
            return true;
        }

        if (!state.summary && state.initialized) {
            await reload();
        }

        if (focusTargetId) {
            scrollPaymentsFocusTarget(focusTargetId);
        }
        return true;
    }

    async function openAdminPaymentsShellContext(context = {}, options = {}) {
        await activatePaymentsModule(context, options);
        return handlePaymentsModuleContext(context, options);
    }

    function handlePaymentsSiteChange() {
        state.requestToken = Date.now() + Math.random();
        resetViewState();

        if (!isPaymentsModuleActive()) {
            return;
        }

        if (!state.initialized) {
            void activatePaymentsModule({}, { force: true });
            return;
        }

        void reload();
    }

    function activateVisiblePaymentsModuleOnAccess() {
        if (!isPaymentsModuleActive()) {
            return;
        }

        void activatePaymentsModule();
    }

    function scheduleVisiblePaymentsModuleActivation() {
        const activate = () => activateVisiblePaymentsModuleOnAccess();
        if (typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(activate);
        } else {
            window.setTimeout(activate, 0);
        }

        window.setTimeout(activate, 120);
        window.setTimeout(activate, 600);
    }

    function bootstrapPaymentsModuleActivation() {
        scheduleVisiblePaymentsModuleActivation();
        window.addEventListener('adminStudioAccessGranted', scheduleVisiblePaymentsModuleActivation, { once: true });
    }

    function handlePaymentsShellModuleActivated(event = {}) {
        const moduleId = String(event?.detail?.moduleId || '').trim().toLowerCase();
        if (moduleId !== 'payments') {
            return;
        }

        scheduleVisiblePaymentsModuleActivation();
    }

    window.handleAdminPaymentsSiteChange = handlePaymentsSiteChange;
    window.openAdminPaymentsShellContext = openAdminPaymentsShellContext;

    if (window.AdminShell?.registerModule) {
        window.AdminShell.registerModule('payments', {
            activate: activatePaymentsModule,
            handleContext: handlePaymentsModuleContext,
            onSiteChange: handlePaymentsSiteChange,
            reload: handlePaymentsSiteChange
        });
    } else {
        window.addEventListener('admin-site-changed', window.handleAdminPaymentsSiteChange);
    }

    window.addEventListener('admin-shell-module-activated', handlePaymentsShellModuleActivated);
    if (document.readyState && document.readyState !== 'loading') {
        bootstrapPaymentsModuleActivation();
    } else {
        document.addEventListener('DOMContentLoaded', bootstrapPaymentsModuleActivation);
    }

    window.AdminPayments = {
        init,
        reload,
        getCommandCenterSummary: getPaymentsCommandCenterSummary,
        primeCommandCenterSummary: primePaymentsCommandCenterSummary,
        switchTab,
        scheduleTabPrefetch,
        getActiveTab: () => state.activeTab,
        setDays,
        applyCustomRange,
        toggleRangeMenu,
        exportData,
        previewCleanup,
        cleanupTestData,
        goToPage,
        copyOrderNo,
        handleAnomalyAction,
        handleBatchAnomalyAction,
        setExceptionTopicFilter,
        focusExceptionTopic,
        focusOpsAlertQueue,
        focusAnalyticsIssueSummary,
        focusAnalyticsPrioritySummary,
        focusOrder,
        getLastFocusResult: () => (state.lastFocusResult ? { ...state.lastFocusResult } : null),
        showWorkbenchContext
    };
})();
