// Shared analytics workbench navigation and operations helpers.

function buildAnalyticsPaymentsSummaryQuery(view = 'ops') {
    const { days, startDate, endDate } = getAnalyticsRangeState();
    const query = new URLSearchParams({
        view: String(view || 'ops')
    });
    const site = getAnalyticsSiteParam();

    if (site) {
        query.set('site', site);
    }

    if (startDate && endDate) {
        const startIso = toAnalyticsRangeBoundaryIso(startDate, false);
        const endIso = toAnalyticsRangeBoundaryIso(endDate, true);
        if (startIso && endIso) {
            query.set('startDate', startIso);
            query.set('endDate', endIso);
            return query;
        }
    }

    query.set('days', String(days || DEFAULT_ANALYTICS_DAYS));
    return query;
}

function serializeAnalyticsActionContext(context = null) {
    if (!context || typeof context !== 'object' || Array.isArray(context)) {
        return '';
    }

    try {
        const serialized = JSON.stringify(context);
        return serialized && serialized !== '{}' ? encodeURIComponent(serialized) : '';
    } catch (error) {
        console.warn('[Analytics] Failed to serialize action context:', error);
        return '';
    }
}

function parseAnalyticsActionContext(context = null) {
    if (!context) return {};
    if (typeof context === 'object' && !Array.isArray(context)) return context;

    const raw = String(context || '').trim();
    if (!raw) return {};

    const candidates = [raw];
    try {
        const decoded = decodeURIComponent(raw);
        if (decoded !== raw) {
            candidates.unshift(decoded);
        }
    } catch (_) {
        // Ignore decode failures and fall through to raw parse attempt.
    }

    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed;
            }
        } catch (_) {
            // Try next candidate.
        }
    }

    return {};
}

const ANALYTICS_RESOLUTION_FEEDBACK_STORAGE_KEY = 'adminAnalyticsResolutionFeedback';
const ANALYTICS_RESOLUTION_FEEDBACK_LIMIT = 20;
const ANALYTICS_RESOLUTION_FEEDBACK_TTL_MS = 3 * 24 * 60 * 60 * 1000;

function resolveAnalyticsResolutionFeedbackStatus(entry = {}) {
    const normalizedStatusKey = String(entry?.statusKey || '').trim().toLowerCase();
    if (normalizedStatusKey === 'resolved') {
        return { key: 'resolved', label: '已处理', tone: 'success' };
    }
    if (normalizedStatusKey === 'review') {
        return { key: 'review', label: '待复查', tone: 'warning' };
    }
    if (normalizedStatusKey === 'abnormal') {
        return { key: 'abnormal', label: '仍异常', tone: 'danger' };
    }

    const actionLabel = String(entry?.actionLabel || '').trim();
    if (actionLabel.includes('登记重试') || actionLabel.includes('重新打开')) {
        return { key: 'abnormal', label: '仍异常', tone: 'danger' };
    }
    if (actionLabel.includes('忽略') || actionLabel.includes('驳回') || actionLabel.includes('拒绝') || actionLabel.includes('关闭')) {
        return { key: 'review', label: '待复查', tone: 'warning' };
    }
    if (
        actionLabel.includes('处理')
        || actionLabel.includes('退款')
        || actionLabel.includes('审核通过')
        || actionLabel.includes('人工放行')
        || actionLabel.includes('标记已处理')
    ) {
        return { key: 'resolved', label: '已处理', tone: 'success' };
    }

    const normalizedTone = String(entry?.tone || '').trim().toLowerCase();
    if (normalizedTone === 'success') {
        return { key: 'resolved', label: '已处理', tone: 'success' };
    }
    if (normalizedTone === 'warning') {
        return { key: 'review', label: '待复查', tone: 'warning' };
    }
    if (normalizedTone === 'danger') {
        return { key: 'abnormal', label: '仍异常', tone: 'danger' };
    }
    return { key: 'resolved', label: '已处理', tone: 'success' };
}

function normalizeAnalyticsResolutionFeedbackEntry(entry = {}) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return null;
    }

    const createdAt = Number(entry.createdAt || Date.now());
    const productId = String(entry.productId || '').trim();
    const productName = String(entry.productName || '').trim();
    const feedbackScope = String(entry.feedbackScope || '').trim().toLowerCase();
    const entityType = String(entry.entityType || '').trim().toLowerCase();
    const entityId = String(entry.entityId || '').trim();
    const entityName = String(entry.entityName || '').trim();
    const title = String(entry.title || '').trim();
    if (!createdAt || (!productId && !productName && !entityId && !entityName && !feedbackScope) || !title) {
        return null;
    }

    const statusMeta = resolveAnalyticsResolutionFeedbackStatus(entry);

    return {
        id: String(entry.id || `${createdAt}:${productId || productName || entityId || entityName || feedbackScope}`),
        createdAt,
        module: String(entry.module || '').trim().toLowerCase() || 'analytics',
        productId,
        productName,
        feedbackScope,
        entityType,
        entityId,
        entityName,
        title,
        summary: String(entry.summary || '').trim(),
        actionLabel: String(entry.actionLabel || '').trim(),
        referenceLabel: String(entry.referenceLabel || '').trim(),
        referenceValue: String(entry.referenceValue || '').trim(),
        tone: String(entry.tone || '').trim().toLowerCase() || statusMeta.tone,
        statusKey: statusMeta.key,
        statusLabel: statusMeta.label
    };
}

function readAnalyticsResolutionFeedbackEntries() {
    try {
        const raw = window.localStorage?.getItem(ANALYTICS_RESOLUTION_FEEDBACK_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        const now = Date.now();
        return parsed
            .map((entry) => normalizeAnalyticsResolutionFeedbackEntry(entry))
            .filter((entry) => entry && (now - entry.createdAt) <= ANALYTICS_RESOLUTION_FEEDBACK_TTL_MS)
            .sort((left, right) => right.createdAt - left.createdAt)
            .slice(0, ANALYTICS_RESOLUTION_FEEDBACK_LIMIT);
    } catch (_error) {
        return [];
    }
}

function writeAnalyticsResolutionFeedbackEntries(entries = []) {
    try {
        window.localStorage?.setItem(ANALYTICS_RESOLUTION_FEEDBACK_STORAGE_KEY, JSON.stringify(entries));
    } catch (_error) {
        // Ignore storage failures and keep the writeback session best-effort.
    }
}

function recordAnalyticsResolutionFeedback(entry = {}) {
    const normalized = normalizeAnalyticsResolutionFeedbackEntry({
        ...entry,
        createdAt: entry?.createdAt || Date.now()
    });
    if (!normalized) {
        return null;
    }

    const nextEntries = [
        normalized,
        ...readAnalyticsResolutionFeedbackEntries().filter((item) => item.id !== normalized.id)
    ].slice(0, ANALYTICS_RESOLUTION_FEEDBACK_LIMIT);

    writeAnalyticsResolutionFeedbackEntries(nextEntries);
    window.dispatchEvent(new CustomEvent('analytics-resolution-feedback-updated', {
        detail: normalized
    }));
    return normalized;
}

function getAnalyticsResolutionFeedbackEntries(options = {}) {
    const productId = String(options?.productId || '').trim();
    const productName = String(options?.productName || '').trim();
    const module = String(options?.module || '').trim().toLowerCase();
    const feedbackScope = String(options?.feedbackScope || '').trim().toLowerCase();
    const entityType = String(options?.entityType || '').trim().toLowerCase();
    const entityId = String(options?.entityId || '').trim();
    const entityName = String(options?.entityName || '').trim();
    return readAnalyticsResolutionFeedbackEntries().filter((entry) => {
        if (productId && String(entry.productId || '').trim() !== productId) {
            return false;
        }
        if (productName && !productId && String(entry.productName || '').trim() !== productName) {
            return false;
        }
        if (module && String(entry.module || '').trim().toLowerCase() !== module) {
            return false;
        }
        if (feedbackScope && String(entry.feedbackScope || '').trim().toLowerCase() !== feedbackScope) {
            return false;
        }
        if (entityType && String(entry.entityType || '').trim().toLowerCase() !== entityType) {
            return false;
        }
        if (entityId && String(entry.entityId || '').trim() !== entityId) {
            return false;
        }
        if (entityName && !entityId && String(entry.entityName || '').trim() !== entityName) {
            return false;
        }
        return true;
    });
}

function getAnalyticsActionPriority(level = '') {
    const normalized = String(level || '').trim();
    if (normalized.includes('优先')) return 0;
    if (normalized.includes('建议复核')) return 1;
    if (normalized.includes('建议跟进')) return 2;
    if (normalized.includes('可跟进')) return 3;
    if (normalized.includes('持续观察') || normalized.includes('运营观察')) return 4;
    if (normalized.includes('状态良好')) return 5;
    return 6;
}

function getAnalyticsDestinationMeta(destination = '', panel = '') {
    switch (String(destination || '').trim().toLowerCase()) {
        case 'payments':
        case 'payments-overview':
            return { icon: 'fas fa-credit-card', ctaLabel: '打开支付总览' };
        case 'payments-queue':
            return { icon: 'fas fa-tower-broadcast', ctaLabel: '查看支付告警队列' };
        case 'payments-ops':
            return { icon: 'fas fa-shield-heart', ctaLabel: '进入支付异常运维' };
        case 'payments-finance':
            return { icon: 'fas fa-sack-dollar', ctaLabel: '查看全站收支' };
        case 'tickets':
        case 'tickets-pending':
            return { icon: 'fas fa-life-ring', ctaLabel: '进入工单队列' };
        case 'tickets-overdue':
            return { icon: 'fas fa-clock', ctaLabel: '查看超时工单' };
        case 'tickets-overview':
            return { icon: 'fas fa-chart-pie', ctaLabel: '查看工单看板' };
        case 'tickets-summary':
            return { icon: 'fas fa-list-check', ctaLabel: '查看工单汇总' };
        case 'verify-monitor':
            return { icon: 'fas fa-wave-square', ctaLabel: '前往 Verify Monitor' };
        case 'settings-google-one':
            return { icon: 'fas fa-sliders', ctaLabel: '检查 Google One 配置' };
        case 'settings-affiliate':
            return { icon: 'fas fa-share-nodes', ctaLabel: '查看推广配置' };
        case 'comments-guestbook':
            return { icon: 'fas fa-comments', ctaLabel: '处理留言治理' };
        case 'analytics-monetization':
            return { icon: 'fas fa-wallet', ctaLabel: '查看积分与交易' };
        case 'analytics-content':
            return { icon: 'fas fa-fire', ctaLabel: '回看内容增长' };
        case 'analytics-product':
            return { icon: 'fas fa-box-open', ctaLabel: '查看商品经营' };
        case 'analytics-product-detail':
            return { icon: 'fas fa-cube', ctaLabel: '查看单品详情' };
        case 'points':
            return { icon: 'fas fa-ticket-alt', ctaLabel: '查看积分批次' };
        case 'analytics-overview':
            return { icon: 'fas fa-compass-drafting', ctaLabel: '回到经营总览' };
        case 'analytics-growth':
            return { icon: 'fas fa-bullhorn', ctaLabel: '查看社区与裂变' };
        case 'analytics-ai':
            return { icon: 'fas fa-wand-magic-sparkles', ctaLabel: '打开手动分析' };
        default:
            return {
                icon: panel === '验证服务' ? 'fas fa-shield-halved' : 'fas fa-arrow-right',
                ctaLabel: '打开对应模块'
            };
    }
}

function getAnalyticsOpsQueueLabel(status = '') {
    const normalized = String(status || '').trim().toLowerCase();
    if (normalized === 'dead_letter') return '死信';
    if (normalized === 'retry') return '重试中';
    if (normalized === 'handled') return '已处理';
    if (normalized === 'ignored') return '已忽略';
    if (normalized === 'active') return '处理中';
    if (normalized === 'pending') return '待处理';
    return normalized ? status : '告警';
}

function getAnalyticsSeverityLabel(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'danger' || normalized === 'critical' || normalized === 'error') return '高危';
    if (normalized === 'warning' || normalized === 'warn') return '告警';
    if (normalized === 'success') return '正常';
    if (normalized === 'info') return '信息';
    return normalized ? value : '';
}

function getAnalyticsPaymentReferenceValue(item = {}) {
    return [
        item?.payment_order_id,
        item?.order_id,
        item?.provider_order_no,
        item?.reference_value,
        item?.target_id,
        item?.topic_label,
        item?.topic_key
    ].map((value) => String(value || '').trim()).find(Boolean) || '';
}

function formatAnalyticsPaymentAlertSample(item = {}) {
    const title = truncateAnalyticsSnippet(item?.title || item?.message || item?.topic_label || '支付异常', 20);
    const status = getAnalyticsOpsQueueLabel(item?.queue_status) || getAnalyticsSeverityLabel(item?.severity);
    const reference = truncateAnalyticsSnippet(getAnalyticsPaymentReferenceValue(item), 20);
    return [title, status, reference].filter(Boolean).join(' · ');
}

function formatAnalyticsTicketFocusSample(item = {}) {
    const ticketId = String(item?.ticket_id || item?.target_id || item?.id || '').trim() || '工单';
    const status = truncateAnalyticsSnippet(
        item?.ticket_status_label
        || item?.status
        || item?.severity
        || '',
        12
    );
    const summary = truncateAnalyticsSnippet(
        item?.wait_label
        || item?.title
        || item?.reason
        || item?.order_id
        || '',
        22
    );
    return [ticketId, status, summary].filter(Boolean).join(' · ');
}

function normalizeAnalyticsTicketsOverviewPayload(payload = {}) {
    const backlogSource = payload?.backlog && typeof payload.backlog === 'object' ? payload.backlog : {};
    const reminderSource = payload?.reminder && typeof payload.reminder === 'object' ? payload.reminder : {};
    const activitySource = reminderSource?.activity && typeof reminderSource.activity === 'object' ? reminderSource.activity : {};
    const digestSource = reminderSource?.summary_digest && typeof reminderSource.summary_digest === 'object' ? reminderSource.summary_digest : {};

    return {
        backlog: {
            total_pending: normalizeAnalyticsCountValue(backlogSource.total_pending),
            unassigned_count: normalizeAnalyticsCountValue(backlogSource.unassigned_count),
            overdue_count: normalizeAnalyticsCountValue(backlogSource.overdue_count),
            critical_overdue_count: normalizeAnalyticsCountValue(backlogSource.critical_overdue_count),
            high_priority_count: normalizeAnalyticsCountValue(backlogSource.high_priority_count),
            refundable_count: normalizeAnalyticsCountValue(backlogSource.refundable_count),
            oldest_wait_minutes: normalizeAnalyticsCountValue(backlogSource.oldest_wait_minutes)
        },
        reminder: {
            activity: {
                active_count: normalizeAnalyticsCountValue(activitySource.active_count),
                retry_count: normalizeAnalyticsCountValue(activitySource.retry_count),
                dead_letter_count: normalizeAnalyticsCountValue(activitySource.dead_letter_count),
                latest_overdue: activitySource.latest_overdue && typeof activitySource.latest_overdue === 'object'
                    ? activitySource.latest_overdue
                    : null
            },
            summary_digest: {
                failure_job_count: normalizeAnalyticsCountValue(digestSource.failure_job_count),
                retry_count: normalizeAnalyticsCountValue(digestSource.retry_count),
                dead_letter_count: normalizeAnalyticsCountValue(digestSource.dead_letter_count),
                latest_problem_job: digestSource.latest_problem_job && typeof digestSource.latest_problem_job === 'object'
                    ? digestSource.latest_problem_job
                    : null
            }
        }
    };
}

function buildOperationsHealthSnapshotFromPayloads({
    paymentsPayload = {},
    ticketsPayload = {}
} = {}) {
    const opsAlertSummary = paymentsPayload?.ops_alert_summary && typeof paymentsPayload.ops_alert_summary === 'object'
        ? paymentsPayload.ops_alert_summary
        : {};
    const opsAlertItems = Array.isArray(paymentsPayload?.ops_alert_items) ? paymentsPayload.ops_alert_items : [];
    const recentAnomalies = Array.isArray(paymentsPayload?.recent_anomalies) ? paymentsPayload.recent_anomalies : [];
    const exceptionTopics = Array.isArray(paymentsPayload?.exception_topics) ? paymentsPayload.exception_topics : [];
    const exceptionTopicItems = Array.isArray(paymentsPayload?.exception_topic_items) ? paymentsPayload.exception_topic_items : [];
    const normalizedTickets = typeof window.AdminTickets?.normalizeOverviewPayload === 'function'
        ? window.AdminTickets.normalizeOverviewPayload(ticketsPayload?.overview || ticketsPayload || {})
        : normalizeAnalyticsTicketsOverviewPayload(ticketsPayload?.overview || ticketsPayload || {});
    const backlog = normalizedTickets?.backlog || {};
    const reminderActivity = normalizedTickets?.reminder?.activity || {};
    const reminderDigest = normalizedTickets?.reminder?.summary_digest || {};

    const paymentsSummary = {
        alertTotal: normalizeAnalyticsCountValue(opsAlertSummary.total),
        deadLetterCount: normalizeAnalyticsCountValue(opsAlertSummary.dead_letter),
        retryCount: normalizeAnalyticsCountValue(opsAlertSummary.retry),
        handledCount: normalizeAnalyticsCountValue(opsAlertSummary.handled),
        ignoredCount: normalizeAnalyticsCountValue(opsAlertSummary.ignored),
        anomalyCount: recentAnomalies.length,
        exceptionTopicCount: exceptionTopics.reduce((sum, item) => sum + normalizeAnalyticsCountValue(item?.count), 0)
    };

    const ticketsSummary = {
        pendingCount: normalizeAnalyticsCountValue(backlog.total_pending),
        overdueCount: normalizeAnalyticsCountValue(backlog.overdue_count),
        criticalOverdueCount: normalizeAnalyticsCountValue(backlog.critical_overdue_count),
        unassignedCount: normalizeAnalyticsCountValue(backlog.unassigned_count),
        highPriorityCount: normalizeAnalyticsCountValue(backlog.high_priority_count),
        oldestWaitMinutes: normalizeAnalyticsCountValue(backlog.oldest_wait_minutes),
        reminderRetryCount: normalizeAnalyticsCountValue(reminderActivity.retry_count || reminderDigest.retry_count),
        reminderDeadLetterCount: normalizeAnalyticsCountValue(reminderActivity.dead_letter_count || reminderDigest.dead_letter_count),
        reminderFailureCount: normalizeAnalyticsCountValue(reminderDigest.failure_job_count)
    };

    return {
        metrics: {
            paymentAlertTotal: paymentsSummary.alertTotal,
            paymentDeadLetterCount: paymentsSummary.deadLetterCount,
            paymentRetryCount: paymentsSummary.retryCount,
            paymentAnomalyCount: paymentsSummary.anomalyCount,
            paymentExceptionTopicCount: paymentsSummary.exceptionTopicCount,
            ticketPendingCount: ticketsSummary.pendingCount,
            ticketOverdueCount: ticketsSummary.overdueCount,
            ticketCriticalOverdueCount: ticketsSummary.criticalOverdueCount,
            ticketOldestWaitMinutes: ticketsSummary.oldestWaitMinutes,
            ticketReminderRetryCount: ticketsSummary.reminderRetryCount,
            ticketReminderDeadLetterCount: ticketsSummary.reminderDeadLetterCount
        },
        payments: {
            summary: paymentsSummary,
            opsAlertItems,
            recentAnomalies,
            exceptionTopics,
            exceptionTopicItems,
            focusAlert: opsAlertItems[0] || recentAnomalies[0] || exceptionTopicItems[0] || null
        },
        tickets: {
            overview: normalizedTickets,
            backlog: ticketsSummary,
            focusOverdue: reminderActivity.latest_overdue || reminderDigest.latest_problem_job || null
        },
        samples: {
            paymentAlerts: [...opsAlertItems, ...recentAnomalies, ...exceptionTopicItems]
                .slice(0, 4)
                .map((item) => formatAnalyticsPaymentAlertSample(item)),
            ticketIssues: [
                reminderActivity.latest_overdue,
                reminderDigest.latest_problem_job
            ].filter(Boolean).slice(0, 3).map((item) => formatAnalyticsTicketFocusSample(item))
        },
        exportRows: [
            {
                '指标': '支付告警总数',
                '数值': paymentsSummary.alertTotal,
                '说明': `死信 ${paymentsSummary.deadLetterCount} / 重试 ${paymentsSummary.retryCount} / 专题 ${paymentsSummary.exceptionTopicCount}`
            },
            {
                '指标': '支付异常样本',
                '数值': paymentsSummary.anomalyCount,
                '说明': `${recentAnomalies.length} 条最近异常`
            },
            {
                '指标': '工单待处理',
                '数值': ticketsSummary.pendingCount,
                '说明': `超时 ${ticketsSummary.overdueCount} / critical ${ticketsSummary.criticalOverdueCount}`
            },
            {
                '指标': '最老等待时长',
                '数值': ticketsSummary.oldestWaitMinutes,
                '说明': formatAnalyticsMinutesWindow(ticketsSummary.oldestWaitMinutes)
            },
            {
                '指标': '工单提醒重试',
                '数值': ticketsSummary.reminderRetryCount,
                '说明': `提醒死信 ${ticketsSummary.reminderDeadLetterCount} / 失败摘要 ${ticketsSummary.reminderFailureCount}`
            }
        ]
    };
}

function scheduleAnalyticsNavigationStep(callback, delay = 90) {
    if (typeof callback !== 'function') return;

    window.requestAnimationFrame(() => {
        window.setTimeout(() => {
            try {
                callback();
            } catch (error) {
                console.warn('[Analytics] Deferred navigation step failed:', error);
            }
        }, delay);
    });
}

function focusAnalyticsDestinationTarget(targetOrId, options = {}) {
    const resolvedTarget = typeof targetOrId === 'string'
        ? document.getElementById(String(targetOrId || '').trim())
        : targetOrId;
    const focusTarget = resolvedTarget instanceof HTMLElement
        ? (
            resolvedTarget.closest?.('.chart-card, .kpi-card, .config-card, .points-batch-row, .lookup-card, .verify-monitor-item, .ops-alert-monitor-item, .admin-audit-monitor-item')
            || resolvedTarget
        )
        : null;

    document.querySelectorAll('.analytics-nav-focus-target--active').forEach((element) => {
        element.classList.remove('analytics-nav-focus-target--active');
    });

    if (!(focusTarget instanceof HTMLElement)) {
        return false;
    }

    focusTarget.classList.add('analytics-nav-focus-target--active');
    focusTarget.scrollIntoView({
        behavior: 'smooth',
        block: options.block || 'center'
    });

    if (analyticsDestinationFocusTimeoutId) {
        window.clearTimeout(analyticsDestinationFocusTimeoutId);
    }

    analyticsDestinationFocusTimeoutId = window.setTimeout(() => {
        focusTarget.classList.remove('analytics-nav-focus-target--active');
    }, 2600);

    return true;
}

function scheduleAnalyticsWorkbenchOpen(workspaceKey = '', context = {}, delay = 120) {
    const normalizedWorkspaceKey = String(workspaceKey || '').trim().toLowerCase();
    if (!normalizedWorkspaceKey) {
        return false;
    }

    const launcher = window.openAdminWorkbenchEntry || window.openOpsAlertWorkspace;
    if (typeof launcher !== 'function') {
        return false;
    }

    scheduleAnalyticsNavigationStep(() => {
        void Promise.resolve(launcher(normalizedWorkspaceKey, context)).catch((error) => {
            console.warn('[Analytics] Failed to open admin workbench destination:', error);
        });
    }, delay);
    return true;
}

async function openAnalyticsPaymentsContext(mode = 'overview', context = {}) {
    const normalizedMode = String(mode || 'overview').trim().toLowerCase();
    const normalizedContext = context && typeof context === 'object' && !Array.isArray(context)
        ? context
        : {};
    const targetTab = normalizedMode === 'finance'
        ? 'finance'
        : (normalizedMode === 'ops' || normalizedMode === 'queue' ? 'ops' : 'overview');
    const paymentOrderId = String(
        normalizedContext.paymentOrderId
        || normalizedContext.orderId
        || normalizedContext.providerOrderNo
        || ''
    ).trim();
    const topicKey = String(
        normalizedContext.topicKey
        || normalizedContext.exceptionTopic
        || normalizedContext.topic
        || ''
    ).trim().toLowerCase();
    const focusTargetId = String(
        normalizedContext.focusTargetId
        || normalizedContext.sectionId
        || (normalizedMode === 'queue'
            ? 'paymentsOpsAlertQueuePanel'
            : (targetTab === 'ops' ? 'paymentsExceptionTopics' : (targetTab === 'finance' ? 'paymentsSitewideGrid' : 'paymentsOverviewGrid')))
    ).trim();

    const switched = window.switchModule?.('payments');
    if (switched === false) {
        return false;
    }

    await window.AdminPayments?.init?.();
    window.AdminPayments?.showWorkbenchContext?.(normalizedContext);

    if (paymentOrderId && typeof window.AdminPayments?.focusOrder === 'function') {
        await window.AdminPayments.focusOrder(paymentOrderId, {
            switchTab: true,
            reload: true
        });
        return true;
    }

    if (normalizedMode === 'queue' && typeof window.AdminPayments?.focusOpsAlertQueue === 'function') {
        await window.AdminPayments.focusOpsAlertQueue();
        return true;
    }

    if ((normalizedMode === 'ops' || topicKey) && typeof window.AdminPayments?.focusExceptionTopic === 'function') {
        await window.AdminPayments.focusExceptionTopic(topicKey || 'all');
        return true;
    }

    window.AdminPayments?.switchTab?.(targetTab, { reload: false });
    if (focusTargetId) {
        scheduleAnalyticsNavigationStep(() => {
            focusAnalyticsDestinationTarget(focusTargetId, { block: 'start' });
        }, 120);
    }
    return true;
}

async function openAnalyticsTicketsContext(mode = 'pending', context = {}) {
    const normalizedMode = String(mode || 'pending').trim().toLowerCase();
    const normalizedContext = context && typeof context === 'object' && !Array.isArray(context)
        ? context
        : {};
    const workspace = ['overview', 'summary', 'queue'].includes(String(normalizedContext.workspace || '').trim().toLowerCase())
        ? String(normalizedContext.workspace || '').trim().toLowerCase()
        : (['overview', 'summary'].includes(normalizedMode) ? normalizedMode : 'queue');
    const status = String(
        normalizedContext.status
        || (normalizedMode === 'resolved' ? 'resolved' : 'pending')
    ).trim().toLowerCase();
    const ticketId = String(normalizedContext.ticketId || normalizedContext.targetId || '').trim();
    const searchQuery = String(normalizedContext.search || normalizedContext.referenceValue || '').trim();
    const quickFilter = String(normalizedContext.quickFilter || '').trim().toLowerCase();
    const assigneeFilter = String(normalizedContext.assignee || '').trim().toLowerCase();
    const replyAction = String(normalizedContext.replyAction || '').trim().toLowerCase();
    const focusTargetId = String(
        normalizedContext.focusTargetId
        || normalizedContext.sectionId
        || (workspace === 'overview'
            ? 'ticketsOverviewPanel'
            : (workspace === 'summary' ? 'ticketsOverviewReminderSection' : 'ticketsQueueControls'))
    ).trim();

    const switched = window.switchModule?.('tickets');
    if (switched === false) {
        return false;
    }

    await window.AdminTickets?.init?.();
    window.AdminTickets?.showWorkbenchContext?.(normalizedContext);

    if (ticketId && workspace === 'queue' && typeof window.AdminTickets?.focusTicket === 'function') {
        const focusResult = await window.AdminTickets.focusTicket(ticketId, { status });
        if (focusResult?.matched && replyAction && typeof window.AdminTickets?.openReplyModal === 'function') {
            window.AdminTickets.openReplyModal(ticketId, replyAction === 'rejected' ? 'REJECTED' : 'RESOLVED');
        }
        return true;
    }

    window.AdminTickets?.setWorkspaceView?.(workspace, {
        targetId: focusTargetId,
        scroll: true,
        highlight: true
    });

    if (workspace !== 'queue') {
        return true;
    }

    const normalizedStatus = window.AdminTickets?.normalizeStatusFilter?.(status) || status || 'pending';
    const overdueOnly = normalizedMode === 'overdue' || quickFilter === 'overdue' || normalizedContext.overdueOnly === true;
    const priority = quickFilter === 'priority' || String(normalizedContext.priority || '').trim().toLowerCase() === 'high'
        ? 'high'
        : 'all';
    const assignee = ['mine', 'unassigned'].includes(quickFilter)
        ? quickFilter
        : (['mine', 'unassigned'].includes(assigneeFilter) ? assigneeFilter : 'all');

    if (window.AdminTickets) {
        window.AdminTickets.focusedTicketId = '';
        window.AdminTickets.currentStatus = normalizedStatus;
        window.AdminTickets.quickFilters = {
            overdueOnly,
            priority,
            assignee
        };
        window.AdminTickets.searchQuery = searchQuery;
        window.AdminTickets.syncSearchInput?.();
        window.AdminTickets.syncQuickFilterButtons?.();
    }

    const filterButton = document.querySelector(`[data-admin-action="tickets-filter"][data-ticket-status="${normalizedStatus}"]`);
    await window.AdminTickets?.filter?.(normalizedStatus, filterButton);
    return true;
}

function applyAnalyticsDestinationSiteContext(context = {}) {
    const nextSite = String(context?.site || '').trim().toLowerCase();
    if (!nextSite || !['cn', 'intl'].includes(nextSite)) {
        return false;
    }

    const currentSite = String(window.AdminSiteFilter?.getSiteFilter?.() || 'all').trim().toLowerCase();
    if (currentSite === nextSite) {
        return false;
    }

    window.AdminSiteFilter?.select?.(nextSite);
    return true;
}

function openAnalyticsDestination(destination = '', context = null) {
    const normalized = String(destination || '').trim().toLowerCase();
    const normalizedContext = parseAnalyticsActionContext(context);
    if (!normalized) return false;

    applyAnalyticsDestinationSiteContext(normalizedContext);

    if (normalized.startsWith('workbench-')) {
        const workspaceKey = normalized.slice('workbench-'.length).trim();
        if (!workspaceKey) {
            return false;
        }
        return scheduleAnalyticsWorkbenchOpen(workspaceKey, normalizedContext, 120);
    }

    switch (normalized) {
        case 'analytics-overview':
        case 'analytics-content':
        case 'analytics-product':
        case 'analytics-ops':
        case 'analytics-monetization':
        case 'analytics-verify':
        case 'analytics-growth': {
            const requestedTab = normalized.replace('analytics-', '');
            const analyticsSidebarModule = typeof window.getAdminAnalyticsSidebarModuleIdForTab === 'function'
                ? window.getAdminAnalyticsSidebarModuleIdForTab(requestedTab)
                : 'business-overview';
            const contentPromptId = normalized === 'analytics-content'
                ? String(
                    normalizedContext.promptId
                    || normalizedContext.referenceId
                    || ''
                ).trim()
                : '';
            const contentPromptTitle = normalized === 'analytics-content'
                ? String(
                    normalizedContext.promptTitle
                    || normalizedContext.referenceValue
                    || ''
                ).trim()
                : '';
            const focusSectionId = String(
                normalizedContext.sectionId
                || normalizedContext.focusTargetId
                || normalizedContext.targetId
                || ''
            ).trim();
            const openContentDetail = () => {
                if (
                    normalized === 'analytics-content'
                    && contentPromptId
                    && typeof window.openAnalyticsContentCommerceDetail === 'function'
                ) {
                    window.openAnalyticsContentCommerceDetail(contentPromptId, {
                        promptTitle: contentPromptTitle,
                        focus: false,
                        syncRoute: true
                    });
                }
            };
            if (!isAnalyticsModuleVisible()) {
                const switched = window.switchModule?.(analyticsSidebarModule, { analyticsTab: requestedTab });
                if (switched === false) return false;
                scheduleAnalyticsNavigationStep(() => {
                    switchAnalyticsTab(requestedTab, {
                        sectionId: focusSectionId
                    });
                    openContentDetail();
                    if (focusSectionId) {
                        scheduleAnalyticsNavigationStep(() => {
                            focusAnalyticsDestinationTarget(focusSectionId, { block: 'start' });
                        }, 140);
                    }
                });
            } else {
                switchAnalyticsTab(requestedTab, {
                    sectionId: focusSectionId
                });
                openContentDetail();
                if (focusSectionId) {
                    scheduleAnalyticsNavigationStep(() => {
                        focusAnalyticsDestinationTarget(focusSectionId, { block: 'start' });
                    }, 120);
                }
            }
            return true;
        }
        case 'analytics-ai': {
            const showWorkspace = () => {
                setAnalyticsAdvancedWorkspaceOpen(true, { scrollIntoView: false });
                scheduleAnalyticsNavigationStep(() => {
                    const focusSectionId = String(
                        normalizedContext.sectionId
                        || normalizedContext.focusTargetId
                        || normalizedContext.targetId
                        || 'analyticsAdvancedWorkspace'
                    ).trim();
                    focusAnalyticsDestinationTarget(focusSectionId, { block: 'start' });
                }, 80);
            };

            if (!isAnalyticsModuleVisible()) {
                const switched = window.switchModule?.('business-overview', { analyticsTab: 'overview' });
                if (switched === false) return false;
                scheduleAnalyticsNavigationStep(showWorkspace, 120);
            } else {
                showWorkspace();
            }

            return true;
        }
        case 'analytics-product-detail': {
            const showProductDetail = () => {
                switchAnalyticsTab('product-detail');
                scheduleAnalyticsNavigationStep(() => {
                    const opened = window.openAnalyticsProductDetail?.(normalizedContext.productId, {
                        productName: normalizedContext.productName || '',
                        focus: normalizedContext.focus !== false,
                        detailFocus: normalizedContext.detailFocus || '',
                        focusTargetId: normalizedContext.focusTargetId || ''
                    });
                    if (opened === false) {
                        focusAnalyticsDestinationTarget('productDetailPanelSection', { block: 'start' });
                    }
                }, 100);
            };

            if (!isAnalyticsModuleVisible()) {
                const switched = window.switchModule?.('commerce-center', { analyticsTab: 'product-detail' });
                if (switched === false) return false;
                scheduleAnalyticsNavigationStep(showProductDetail, 120);
            } else {
                showProductDetail();
            }

            return true;
        }
        case 'ops-alerts':
        case 'ops-alerts-overview':
        case 'ops-alerts-strategy':
        case 'ops-alerts-channels':
        case 'ops-alerts-monitors':
        case 'ops-alerts-workspace':
        case 'ops-alerts-health': {
            const switched = window.switchModule?.('ops-alerts');
            if (switched === false) return false;

            const requestedView = normalized === 'ops-alerts'
                ? String(normalizedContext.view || 'overview').trim().toLowerCase() || 'overview'
                : normalized.replace('ops-alerts-', '') || 'overview';
            const allowedViews = new Set(['overview', 'strategy', 'channels', 'monitors', 'workspace', 'health']);
            const targetView = allowedViews.has(requestedView) ? requestedView : 'overview';
            const focusSectionId = String(
                normalizedContext.sectionId
                || normalizedContext.focusTargetId
                || normalizedContext.targetId
                || ''
            ).trim();

            scheduleAnalyticsNavigationStep(() => {
                window.switchOpsAlertsView?.(targetView);
                if (focusSectionId) {
                    scheduleAnalyticsNavigationStep(() => {
                        focusAnalyticsDestinationTarget(focusSectionId, { block: 'start' });
                    }, 140);
                }
            }, 120);
            return true;
        }
        case 'payments-overview':
        case 'payments-finance':
        case 'payments-ops':
        case 'payments-queue': {
            const workbenchKey = normalized === 'payments-ops'
                ? 'payments-ops'
                : (normalized === 'payments-overview' ? 'payments-overview' : '');
            if (workbenchKey && scheduleAnalyticsWorkbenchOpen(workbenchKey, normalizedContext, 120)) {
                return true;
            }
            scheduleAnalyticsNavigationStep(() => {
                void openAnalyticsPaymentsContext(
                    normalized.replace('payments-', ''),
                    normalizedContext
                ).catch((error) => {
                    console.warn('[Analytics] Failed to open payments destination:', error);
                });
            }, 120);
            return true;
        }
        case 'payments':
        case 'points':
        case 'shop':
        case 'users':
        case 'tickets': {
            if (normalized === 'payments') {
                const requestedMode = String(normalizedContext.tab || normalizedContext.mode || '').trim().toLowerCase();
                const paymentsMode = requestedMode === 'finance'
                    ? 'finance'
                    : (normalizedContext.focusQueue === true ? 'queue' : (requestedMode === 'ops' ? 'ops' : 'overview'));
                const workbenchKey = paymentsMode === 'ops' ? 'payments-ops' : (paymentsMode === 'overview' ? 'payments-overview' : '');
                if (workbenchKey && scheduleAnalyticsWorkbenchOpen(workbenchKey, normalizedContext, 120)) {
                    return true;
                }
                scheduleAnalyticsNavigationStep(() => {
                    void openAnalyticsPaymentsContext(paymentsMode, normalizedContext).catch((error) => {
                        console.warn('[Analytics] Failed to open payments context:', error);
                    });
                }, 120);
                return true;
            }
            if (normalized === 'tickets') {
                const requestedMode = String(
                    normalizedContext.mode
                    || normalizedContext.status
                    || normalizedContext.workspace
                    || ''
                ).trim().toLowerCase();
                const ticketMode = ['resolved', 'overview', 'summary', 'overdue'].includes(requestedMode)
                    ? requestedMode
                    : 'pending';
                const workbenchKey = ticketMode === 'resolved' ? 'tickets-resolved' : (ticketMode === 'pending' ? 'tickets-pending' : '');
                if (workbenchKey && scheduleAnalyticsWorkbenchOpen(workbenchKey, normalizedContext, 120)) {
                    return true;
                }
                scheduleAnalyticsNavigationStep(() => {
                    void openAnalyticsTicketsContext(ticketMode, normalizedContext).catch((error) => {
                        console.warn('[Analytics] Failed to open tickets context:', error);
                    });
                }, 120);
                return true;
            }
            if (normalized === 'shop') {
                const requestedTab = String(normalizedContext.tab || normalizedContext.mode || 'products').trim().toLowerCase() || 'products';
                const switched = window.switchModule?.('shop');
                if (switched === false) return false;
                scheduleAnalyticsNavigationStep(() => {
                    window.ShopAdmin?.switchTab?.(requestedTab);
                }, 120);
                return true;
            }

            const switched = window.switchModule?.(normalized);
            if (switched === false) return false;
            if (normalized === 'points' && typeof window.openAnalyticsPointsContext === 'function') {
                scheduleAnalyticsNavigationStep(() => {
                    window.openAnalyticsPointsContext?.(normalizedContext);
                }, 120);
            } else if (normalized === 'points' && normalizedContext.batchId && typeof window.navigateToBatch === 'function') {
                scheduleAnalyticsNavigationStep(() => {
                    window.navigateToBatch?.(
                        normalizedContext.batchId,
                        normalizedContext.code ? { code: normalizedContext.code } : {}
                    );
                }, 120);
            }
            return true;
        }
        case 'shop-products':
        case 'shop-import':
        case 'shop-inventory':
        case 'shop-orders':
        case 'shop-fulfillment': {
            const requestedTab = normalized.replace('shop-', '') || 'products';
            const switched = window.switchModule?.('shop');
            if (switched === false) return false;
            scheduleAnalyticsNavigationStep(() => {
                window.ShopAdmin?.switchTab?.(requestedTab);
                const shopDrilldownContext = {
                    site: normalizedContext.site || '',
                    referenceLabel: normalizedContext.referenceLabel || '',
                    referenceValue: normalizedContext.referenceValue || '',
                    refundStatus: normalizedContext.refundStatus || '',
                    deliveryStatus: normalizedContext.deliveryStatus || '',
                    productId: normalizedContext.productId || '',
                    productName: normalizedContext.productName || '',
                    userId: normalizedContext.userId || '',
                    email: normalizedContext.email || '',
                    signalSourceName: normalizedContext.signalSourceName || '',
                    signalLabel: normalizedContext.signalLabel || normalizedContext.targetMetric || '',
                    signalValue: normalizedContext.signalValue || '',
                    rangeLabel: normalizedContext.rangeLabel || '',
                    query: String(
                        normalizedContext.query
                        || normalizedContext.productName
                        || normalizedContext.productId
                        || ''
                    ).trim(),
                    queryLabel: String(normalizedContext.queryLabel || '').trim()
                };

                if (requestedTab === 'products' && normalizedContext.productId && typeof window.ShopAdmin?.editProduct === 'function') {
                    window.setTimeout(() => {
                        void window.ShopAdmin.editProduct(normalizedContext.productId).catch((error) => {
                            console.warn('[Analytics] Failed to open shop product from analytics:', error);
                        });
                    }, 180);
                }

                if (requestedTab === 'orders' && normalizedContext.orderId && typeof window.ShopAdmin?.focusOrder === 'function') {
                    window.ShopAdmin?.setOrderSearchContext?.(shopDrilldownContext);
                    window.setTimeout(() => {
                        void window.ShopAdmin.focusOrder(normalizedContext.orderId, {
                            openDetails: true,
                            context: shopDrilldownContext
                        }).catch((error) => {
                            console.warn('[Analytics] Failed to focus shop order from analytics:', error);
                        });
                    }, 180);
                } else if (requestedTab === 'orders' && typeof window.ShopAdmin?.searchOrders === 'function') {
                    const query = String(
                        normalizedContext.query
                        || normalizedContext.productName
                        || normalizedContext.productId
                        || ''
                    ).trim();
                    window.ShopAdmin?.setOrderSearchContext?.(query || shopDrilldownContext.referenceValue
                        ? {
                            ...shopDrilldownContext,
                            query
                        }
                        : null);
                    if (query) {
                        window.setTimeout(() => {
                            window.ShopAdmin.focusedOrderId = '';
                            window.ShopAdmin.pendingOpenOrderDetails = false;
                            void window.ShopAdmin.searchOrders(1, {
                                queryOverride: query,
                                openDetails: false,
                                context: {
                                    ...shopDrilldownContext,
                                    query
                                }
                            }).catch((error) => {
                                console.warn('[Analytics] Failed to search shop orders from analytics:', error);
                            });
                        }, 180);
                    }
                }

                if (requestedTab === 'inventory' && normalizedContext.inventoryId && typeof window.ShopAdmin?.showInventoryDetail === 'function') {
                    window.setTimeout(() => {
                        void window.ShopAdmin.showInventoryDetail(normalizedContext.inventoryId).catch((error) => {
                            console.warn('[Analytics] Failed to open inventory detail from analytics:', error);
                        });
                    }, 180);
                }

                if (requestedTab === 'fulfillment' && typeof window.ShopAdmin?.loadDeliveryTasks === 'function') {
                    const query = String(
                        normalizedContext.query
                        || normalizedContext.productName
                        || normalizedContext.productId
                        || ''
                    ).trim();
                    const queryType = String(normalizedContext.deliveryQueryType || 'manual').trim().toLowerCase();
                    const deliveryTaskStatus = String(normalizedContext.deliveryTaskStatus || 'all').trim().toLowerCase() || 'all';
                    const deliveryDeadLetterReason = String(normalizedContext.deliveryDeadLetterReason || 'all').trim().toLowerCase() || 'all';
                    const taskId = String(normalizedContext.taskId || '').trim();
                    const orderId = String(normalizedContext.orderId || '').trim();
                    window.ShopAdmin?.setDeliveryWorkbenchContext?.(query || shopDrilldownContext.referenceValue
                        ? {
                            ...shopDrilldownContext,
                            query,
                            queryLabel: String(normalizedContext.queryLabel || query).trim() || query
                        }
                        : null);

                    window.setTimeout(() => {
                        window.ShopAdmin.deliveryTaskQuery = query;
                        window.ShopAdmin.deliveryTaskQueryContext = query
                            ? {
                                type: ['target', 'channel', 'manual'].includes(queryType) ? queryType : 'manual',
                                label: String(normalizedContext.queryLabel || query).trim() || query
                            }
                            : null;
                        window.ShopAdmin.deliveryTaskStatusFilter = deliveryTaskStatus;
                        window.ShopAdmin.deliveryDeadLetterReasonFilter = deliveryDeadLetterReason;
                        window.ShopAdmin.deliveryLockStateFilter = 'all';
                        window.ShopAdmin.deliveryConflictBucketFilter = null;
                        window.ShopAdmin.deliveryConflictAuditSelection = null;
                        window.ShopAdmin.deliveryConflictAuditReasonFilter = 'all';
                        window.ShopAdmin.deliveryConflictAuditTargetFilter = '';
                        window.ShopAdmin.deliveryConflictAuditChannelFilter = '';
                        window.ShopAdmin.deliveryPendingTaskReveal = null;
                        window.ShopAdmin.deliveryPendingAuditReveal = null;
                        window.ShopAdmin.deliveryTaskIdentityFilter = taskId || orderId
                            ? {
                                taskId,
                                orderId
                            }
                            : null;
                        void window.ShopAdmin.loadDeliveryTasks(1).catch((error) => {
                            console.warn('[Analytics] Failed to open fulfillment queue from analytics:', error);
                        });
                    }, 180);
                }
            }, 120);
            return true;
        }
        case 'tickets-pending':
        case 'tickets-resolved':
        case 'tickets-overdue':
        case 'tickets-overview':
        case 'tickets-summary': {
            const workbenchKey = normalized === 'tickets-resolved'
                ? 'tickets-resolved'
                : (normalized === 'tickets-pending' ? 'tickets-pending' : '');
            if (workbenchKey && scheduleAnalyticsWorkbenchOpen(workbenchKey, normalizedContext, 120)) {
                return true;
            }
            scheduleAnalyticsNavigationStep(() => {
                void openAnalyticsTicketsContext(
                    normalized.replace('tickets-', ''),
                    normalizedContext
                ).catch((error) => {
                    console.warn('[Analytics] Failed to open ticket destination:', error);
                });
            }, 120);
            return true;
        }
        case 'comments-guestbook': {
            const switched = window.switchModule?.('comments');
            if (switched === false) return false;
            scheduleAnalyticsNavigationStep(() => {
                if (typeof window.openAnalyticsCommentContext === 'function') {
                    window.openAnalyticsCommentContext({
                        ...normalizedContext,
                        view: 'guestbook'
                    });
                } else {
                    window.switchCommentView?.('guestbook');
                }
            });
            return true;
        }
        case 'comments-gallery': {
            const switched = window.switchModule?.('comments');
            if (switched === false) return false;
            scheduleAnalyticsNavigationStep(() => {
                if (typeof window.openAnalyticsCommentContext === 'function') {
                    window.openAnalyticsCommentContext({
                        ...normalizedContext,
                        view: 'gallery'
                    });
                } else {
                    window.switchCommentView?.('gallery');
                }
            });
            return true;
        }
        case 'settings-google-one': {
            const switched = window.switchModule?.('settings');
            if (switched === false) return false;
            scheduleAnalyticsNavigationStep(() => {
                window.switchSettingsView?.('google-one');
                void window.refreshVerifyMonitor?.(true)?.catch?.((error) => {
                    console.warn('[Analytics] Failed to refresh verify monitor from analytics:', error);
                });
                window.renderVerifyMonitorWorkbenchContext?.(normalizedContext);
                if (Object.keys(normalizedContext).length > 0) {
                    window.setTimeout(() => {
                        window.focusVerifyMonitorWorkspace?.(normalizedContext);
                    }, 160);
                }
            });
            return true;
        }
        case 'settings-affiliate': {
            const switched = window.switchModule?.('settings');
            if (switched === false) return false;
            scheduleAnalyticsNavigationStep(() => {
                window.switchSettingsView?.('affiliate');
                if (Object.keys(normalizedContext).length > 0) {
                    window.setTimeout(() => {
                        window.focusAffiliateSettingsContext?.(normalizedContext);
                    }, 140);
                }
            });
            return true;
        }
        case 'verify-monitor': {
            const switched = window.switchModule?.('settings');
            if (switched === false) return false;
            scheduleAnalyticsNavigationStep(() => {
                window.switchSettingsView?.('google-one');
                if (typeof window.openOpsAlertWorkspace === 'function') {
                    void Promise.resolve(window.openOpsAlertWorkspace('verify-monitor', normalizedContext)).catch((error) => {
                        console.warn('[Analytics] Failed to open verify monitor workspace:', error);
                    });
                } else {
                    void window.refreshVerifyMonitor?.(true)?.catch?.((error) => {
                        console.warn('[Analytics] Failed to refresh verify monitor from analytics:', error);
                    });
                    window.renderVerifyMonitorWorkbenchContext?.(normalizedContext);
                    if (Object.keys(normalizedContext).length > 0) {
                        window.setTimeout(() => {
                            window.focusVerifyMonitorWorkspace?.(normalizedContext);
                        }, 160);
                    }
                }
            }, 120);
            return true;
        }
        default: {
            console.warn('[Analytics] Unknown destination:', normalized);
            return false;
        }
    }
}

function renderAnalyticsAISiteComparison(comparisonData = null) {
    if (!comparisonData || comparisonData.mode !== 'compare' || !Array.isArray(comparisonData.snapshots) || comparisonData.snapshots.length < 2) {
        return '';
    }

    const snapshotCards = comparisonData.snapshots.map((snapshot) => {
        const metrics = snapshot.metrics || {};
        const isFocus = snapshot.site === comparisonData.focusSite;
        return `
            <article class="ai-site-card ai-site-card--${isFocus ? 'focus' : 'default'}">
                <div class="ai-site-card__top">
                    <strong class="ai-site-card__title">${escapeHtml(snapshot.label || '站点')}</strong>
                    <span class="analytics-status-chip analytics-status-chip--${isFocus ? 'warning' : 'neutral'}">${isFocus ? '优先关注' : '对照样本'}</span>
                </div>
                <div class="ai-site-card__metrics">
                    <span>经营活跃 ${formatNumber(metrics.businessActiveUsers || 0)}</span>
                    <span>验证 ${formatPercent(metrics.verifySuccessRate || 0)}</span>
                    <span>充值 ${formatPercent(metrics.rechargeSuccessRate || 0)}</span>
                    <span>成交 ${formatPercent(metrics.shopPurchaseRate || 0)}</span>
                    <span>邀请覆盖 ${formatPercent(metrics.inviteCoverageRate || 0)}</span>
                    ${snapshot.topChannel?.name ? `<span>入口 ${escapeHtml(snapshot.topChannel.name)}</span>` : ''}
                    ${snapshot.topCategory?.name ? `<span>分类 ${escapeHtml(snapshot.topCategory.name)}</span>` : ''}
                    ${snapshot.topContent?.title ? `<span>Prompt ${escapeHtml(truncateAnalyticsSnippet(snapshot.topContent.title, 18))}</span>` : ''}
                </div>
            </article>
        `;
    }).join('');

    const insightsMarkup = Array.isArray(comparisonData.insights) && comparisonData.insights.length > 0
        ? `
            <div class="ai-site-board__insights">
                ${comparisonData.insights.map((item) => `<span class="ai-site-board__insight-pill">${escapeHtml(item)}</span>`).join('')}
            </div>
        `
        : '';

    return `
        <section class="ai-site-board">
            <div class="ai-site-board__header">
                <div>
                    <p class="ai-site-board__eyebrow">站点对比</p>
                    <h4 class="ai-site-board__title">当前窗口的 CN / INTL 经营差异</h4>
                </div>
                <span class="ai-site-board__meta">当前更值得先看 ${escapeHtml(comparisonData.focusLabel || '目标站点')}</span>
            </div>
            <div class="ai-site-grid">
                ${snapshotCards}
            </div>
            ${insightsMarkup}
        </section>
    `;
}

async function getOperationsHealthSnapshotData(options = {}) {
    const contextKey = options.contextKey || getAnalyticsAIContextKey();
    return runAnalyticsDerivedRequest(
        'operationsHealthSnapshot',
        async () => {
            const bundle = await getAnalyticsAdminSnapshotBundle({
                contextKey,
                forceRefresh: options.forceRefresh,
                view: 'ops'
            }).catch(() => null);
            const paymentsSegment = getAnalyticsSnapshotBundleSegment(bundle, 'payments');
            const ticketsSegment = getAnalyticsSnapshotBundleSegment(bundle, 'tickets');

            if (paymentsSegment?.ok || ticketsSegment?.ok) {
                return buildOperationsHealthSnapshotFromPayloads({
                    paymentsPayload: paymentsSegment?.ok ? paymentsSegment.payload : {},
                    ticketsPayload: ticketsSegment?.ok ? ticketsSegment.payload : {}
                });
            }

            if (bundle && (paymentsSegment?.ok === false || ticketsSegment?.ok === false)) {
                throw createAnalyticsSnapshotBundleSegmentError(
                    paymentsSegment?.ok === false
                        ? paymentsSegment
                        : ticketsSegment,
                    'Operations health snapshot unavailable'
                );
            }

            const ticketsMetricsUrl = typeof window.AdminTickets?.getTicketsMetricsUrl === 'function'
                ? window.AdminTickets.getTicketsMetricsUrl()
                : '/api/admin?route=tickets/metrics';
            const paymentsQuery = buildAnalyticsPaymentsSummaryQuery('ops');
            const [paymentsResult, ticketsResult] = await Promise.allSettled([
                fetchAnalyticsAdminJson(`/api/admin/payments/summary?${paymentsQuery.toString()}`),
                fetchAnalyticsAdminJson(ticketsMetricsUrl)
            ]);

            return buildOperationsHealthSnapshotFromPayloads({
                paymentsPayload: paymentsResult.status === 'fulfilled' ? paymentsResult.value : {},
                ticketsPayload: ticketsResult.status === 'fulfilled' ? ticketsResult.value : {}
            });
        },
        { contextKey, forceRefresh: options.forceRefresh }
    );
}

window.openAnalyticsDestination = openAnalyticsDestination;
window.recordAnalyticsResolutionFeedback = recordAnalyticsResolutionFeedback;
window.getAnalyticsResolutionFeedbackEntries = getAnalyticsResolutionFeedbackEntries;
