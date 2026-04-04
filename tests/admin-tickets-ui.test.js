const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const adminTicketsPath = path.resolve(__dirname, '../js/admin-tickets.js');

function createSupabaseQuery(rows = []) {
    const state = {
        filters: [],
        orderBy: null
    };

    const query = {
        select() {
            return query;
        },
        in(column, values = []) {
            state.filters.push((row) => values.includes(row?.[column]));
            return query;
        },
        eq(column, value) {
            state.filters.push((row) => row?.[column] === value);
            return query;
        },
        order(column, options = {}) {
            state.orderBy = {
                column,
                ascending: options?.ascending !== false
            };
            return query;
        },
        then(resolve, reject) {
            try {
                let result = Array.isArray(rows) ? rows.slice() : [];
                state.filters.forEach((filter) => {
                    result = result.filter(filter);
                });

                if (state.orderBy?.column) {
                    const direction = state.orderBy.ascending ? 1 : -1;
                    result.sort((left, right) => {
                        const leftValue = left?.[state.orderBy.column];
                        const rightValue = right?.[state.orderBy.column];
                        if (leftValue === rightValue) return 0;
                        return leftValue > rightValue ? direction : -direction;
                    });
                }

                return Promise.resolve({ data: result, error: null }).then(resolve, reject);
            } catch (error) {
                return Promise.reject(error).then(resolve, reject);
            }
        }
    };

    return query;
}

function createSupabaseClientStub(fixtures = {}) {
    const tables = {
        shop_tickets: Array.isArray(fixtures.shop_tickets) ? fixtures.shop_tickets : [],
        profiles: Array.isArray(fixtures.profiles) ? fixtures.profiles : [],
        shop_orders: Array.isArray(fixtures.shop_orders) ? fixtures.shop_orders : [],
        ops_alert_jobs: Array.isArray(fixtures.ops_alert_jobs) ? fixtures.ops_alert_jobs : [],
        ops_alert_job_attempts: Array.isArray(fixtures.ops_alert_job_attempts) ? fixtures.ops_alert_job_attempts : [],
        admin_audit_logs_view: Array.isArray(fixtures.admin_audit_logs_view) ? fixtures.admin_audit_logs_view : [],
        admin_audit_logs: Array.isArray(fixtures.admin_audit_logs) ? fixtures.admin_audit_logs : []
    };

    return {
        auth: {
            async getUser() {
                return { data: { user: null } };
            },
            async getSession() {
                return { data: { session: null } };
            }
        },
        from(table) {
            return createSupabaseQuery(tables[table] || []);
        }
    };
}

function loadAdminTicketsRuntime(options = {}) {
    const script = fs.readFileSync(adminTicketsPath, 'utf8');
    const elements = new Map(Object.entries(options.elements || {}));
    const querySelectors = new Map(Object.entries(options.querySelectors || {}));
    const toasts = [];
    let confirmCalls = [];

    const document = {
        getElementById(id) {
            return elements.get(id) || null;
        },
        createElement() {
            return {
                className: '',
                textContent: '',
                innerHTML: '',
                dataset: {},
                style: {},
                appendChild() {},
                replaceChildren() {},
                setAttribute() {}
            };
        },
        querySelector(selector) {
            if (querySelectors.has(selector)) {
                return querySelectors.get(selector) || null;
            }
            if (selector === '#ticketReplyModal .btn-primary') {
                return elements.get('ticketReplySubmitButton') || null;
            }
            return null;
        },
        querySelectorAll() {
            return [];
        }
    };

    const window = {
        requestAnimationFrame(handler) {
            if (typeof handler === 'function') {
                handler();
            }
            return 1;
        },
        setTimeout(handler) {
            if (typeof handler === 'function') {
                handler();
            }
            return 1;
        },
        clearTimeout() {},
        showToast(message, type) {
            toasts.push({ message, type });
        },
        confirm(message) {
            confirmCalls.push(String(message || ''));
            if (typeof options.confirmResult === 'boolean') {
                return options.confirmResult;
            }
            return true;
        },
        alert() {},
        supabaseClient: options.supabaseClient || createSupabaseClientStub()
    };

    const context = {
        console: {
            log() {},
            warn() {},
            error() {}
        },
        document,
        window,
        navigator: {
            clipboard: {
                writeText() {
                    return Promise.resolve();
                }
            }
        },
        CSS: {
            escape(value) {
                return String(value || '');
            }
        },
        URL,
        URLSearchParams,
        fetch: typeof options.fetchImpl === 'function'
            ? options.fetchImpl
            : async () => ({ ok: true, json: async () => ({ success: true }) })
    };

    window.window = window;
    window.document = document;
    context.globalThis = window;

    vm.runInNewContext(script, context);

    return {
        AdminTickets: window.AdminTickets,
        window,
        toasts,
        getConfirmCalls() {
            return confirmCalls.slice();
        }
    };
}

function createClassList() {
    const values = new Set();
    return {
        add(...tokens) {
            tokens.forEach((token) => values.add(String(token || '')));
        },
        remove(...tokens) {
            tokens.forEach((token) => values.delete(String(token || '')));
        },
        toggle(token, force) {
            const normalized = String(token || '');
            if (force === true) {
                values.add(normalized);
                return true;
            }
            if (force === false) {
                values.delete(normalized);
                return false;
            }
            if (values.has(normalized)) {
                values.delete(normalized);
                return false;
            }
            values.add(normalized);
            return true;
        },
        contains(token) {
            return values.has(String(token || ''));
        }
    };
}

function createElementStub(overrides = {}) {
    return {
        innerHTML: '',
        textContent: '',
        value: '',
        disabled: false,
        dataset: {},
        attributes: {},
        classList: createClassList(),
        setAttribute(name, value) {
            this.attributes[name] = value;
        },
        ...overrides
    };
}

test('admin tickets reply state enables refund only for pending resolved tickets with orders', () => {
    const { AdminTickets } = loadAdminTicketsRuntime();

    const resolvedState = AdminTickets.buildReplyModalState({
        id: 'ticket-1',
        status: 'PENDING',
        order_id: 'order-1'
    }, 'RESOLVED');
    assert.equal(resolvedState.canRefund, true);
    assert.equal(resolvedState.submitLabel, '确认处理');

    const rejectedState = AdminTickets.buildReplyModalState({
        id: 'ticket-2',
        status: 'PENDING',
        order_id: 'order-2'
    }, 'REJECTED');
    assert.equal(rejectedState.canRefund, false);
    assert.match(rejectedState.refundHint, /只有将工单标记为已解决时才允许执行退款/);

    const noOrderState = AdminTickets.buildReplyModalState({
        id: 'ticket-3',
        status: 'PENDING',
        order_id: ''
    }, 'RESOLVED');
    assert.equal(noOrderState.canRefund, false);
    assert.match(noOrderState.refundHint, /没有关联订单/);
});

test('admin tickets detail state exposes summary, source context, and quick actions for the reply panel', () => {
    const { AdminTickets } = loadAdminTicketsRuntime();
    AdminTickets.parseLinkedChatSessionContext = () => ({
        title: '客服催办',
        session_id: 'session-42',
        user_email: 'from-context@example.com'
    });
    AdminTickets.parseLinkedOpsAlertContext = () => null;
    AdminTickets.buildWorkbenchActionDefinitions = () => ([
        {
            icon: 'fa-comments',
            title: '回到客服会话',
            variant: 'chat',
            target: 'chat'
        },
        {
            icon: 'fa-bag-shopping',
            title: '查看关联订单',
            variant: 'order',
            target: 'order'
        }
    ]);

    const detailState = AdminTickets.buildReplyModalDetailState({
        id: 'ticket-detail-1',
        status: 'PENDING',
        issue_type: 'DELIVERY',
        user_id: 'user-1',
        user_email: 'buyer@example.com',
        order_id: 'order-1',
        order_price_paid: 88,
        refund_summary: '可退 88 积分',
        can_refund: true,
        sla_label: '等待 32 分钟',
        description: '用户表示未收到货',
        created_at: '2026-04-03T10:00:00.000Z'
    }, 'RESOLVED');

    assert.equal(detailState.subtitle.includes('客服会话'), true);
    assert.equal(detailState.headerBadges[1].text, '履约问题');
    assert.equal(detailState.summaryItems.some((item) => item.label === '订单实付' && item.value === '88 积分'), true);
    assert.equal(detailState.summaryItems.some((item) => item.label === '退款信息' && item.value === '可退 88 积分'), true);
    assert.equal(detailState.contextItems.some((item) => item.label === '会话标识' && item.value === 'session-42'), true);
    assert.equal(detailState.quickActions.length, 2);
    assert.equal(detailState.templates.length > 0, true);
    assert.equal(detailState.timelineItems.some((item) => item.title === '工单创建'), true);
    assert.equal(detailState.timelineItems.some((item) => item.title.includes('等待处理')), true);
});

test('admin tickets mergeReplyTemplateText appends new template text without duplicating content', () => {
    const { AdminTickets } = loadAdminTicketsRuntime();

    assert.equal(
        AdminTickets.mergeReplyTemplateText('', '模板内容 A'),
        '模板内容 A'
    );
    assert.equal(
        AdminTickets.mergeReplyTemplateText('已有回复', '模板内容 B'),
        '已有回复\n\n模板内容 B'
    );
    assert.equal(
        AdminTickets.mergeReplyTemplateText('已有回复\n\n模板内容 B', '模板内容 B'),
        '已有回复\n\n模板内容 B'
    );
});

test('admin tickets buildReplyTemplates prefers configured ops alert templates and interpolates ticket placeholders', () => {
    const { AdminTickets } = loadAdminTicketsRuntime();
    const ticket = {
        id: 'ticket-template-1',
        status: 'PENDING',
        issue_type: 'REFUND',
        order_id: 'order-template-1',
        refund_summary: '可退 66 积分',
        source_label: '站内代办'
    };
    const state = AdminTickets.buildReplyModalState(ticket, 'RESOLVED');

    AdminTickets.applyTicketReplyTemplateConfig({
        reply_templates: [
            {
                id: 'resolved_generic_custom',
                action: 'resolved',
                issue_type: 'all',
                enabled: true,
                title: '工单 {{ticket_id}}',
                tag: '{{status_label}}',
                body: '当前状态：{{status_label}}。'
            },
            {
                id: 'resolved_refund_custom',
                action: 'resolved',
                issue_type: 'refund',
                enabled: true,
                title: '退款工单 {{ticket_id}}',
                tag: '{{source_label}}',
                body: '订单 {{order_id}} {{refund_summary}}'
            },
            {
                id: 'rejected_generic_custom',
                action: 'rejected',
                issue_type: 'all',
                enabled: true,
                title: '拒绝模板',
                tag: '拒绝',
                body: '请补充资料'
            }
        ]
    });

    const templates = AdminTickets.buildReplyTemplates(ticket, state);

    assert.equal(templates.length, 2);
    assert.equal(templates[0].key, 'resolved_refund_custom');
    assert.equal(templates[0].title, '退款工单 ticket-template-1');
    assert.equal(templates[0].tag, '站内代办');
    assert.equal(templates[0].body, '订单 order-template-1 可退 66 积分');
    assert.equal(templates[1].key, 'resolved_generic_custom');
    assert.equal(templates[1].title, '工单 ticket-template-1');
    assert.equal(templates[1].tag, '已解决');
    assert.equal(templates[1].body, '当前状态：已解决。');
});

test('admin tickets updates configured reply templates from ops alert config events', () => {
    const { AdminTickets } = loadAdminTicketsRuntime();
    const ticket = {
        id: 'ticket-template-2',
        status: 'PENDING',
        issue_type: 'OTHER',
        order_id: '',
        source_label: '用户提交'
    };
    const rejectedState = AdminTickets.buildReplyModalState(ticket, 'REJECTED');

    AdminTickets.handleOpsAlertsConfigUpdated({
        detail: {
            config: {
                tickets: {
                    reply_templates: [
                        {
                            id: 'rejected_custom_other',
                            action: 'rejected',
                            issue_type: 'other',
                            enabled: true,
                            title: '补充工单 {{ticket_id}}',
                            tag: '待补充',
                            body: '请补充 {{issue_type_label}} 的截图。'
                        }
                    ]
                }
            }
        }
    });

    const templates = AdminTickets.buildReplyTemplates(ticket, rejectedState);
    assert.equal(AdminTickets.getConfiguredTicketReplyTemplates().length, 1);
    assert.equal(templates.length, 1);
    assert.equal(templates[0].title, '补充工单 ticket-template-2');
    assert.equal(templates[0].body, '请补充 其他问题 的截图。');
});

test('admin tickets mergeReplyTimelineItems preserves audit history and appends the pending wait state', () => {
    const { AdminTickets } = loadAdminTicketsRuntime();

    const mergedItems = AdminTickets.mergeReplyTimelineItems([
        {
            title: '工单等待处理中',
            time: '2026-04-03T11:00:00.000Z',
            detail: '等待 30 分钟'
        }
    ], [
        {
            title: '从客服会话创建工单',
            time: '2026-04-03T10:00:00.000Z',
            detail: '会话ID：session-42'
        }
    ]);

    assert.equal(mergedItems.length, 2);
    assert.equal(mergedItems[0].title, '从客服会话创建工单');
    assert.equal(mergedItems[1].title, '工单等待处理中');
});

test('admin tickets page changes are clamped to the valid range', () => {
    const fetchPages = [];
    const { AdminTickets } = loadAdminTicketsRuntime({
        fetchImpl: async (url) => {
            const requestUrl = new URL(url, 'http://localhost');
            const page = Number(requestUrl.searchParams.get('page') || '1');
            fetchPages.push(page);
            return {
                ok: true,
                json: async () => ({
                    success: true,
                    rows: [],
                    pagination: {
                        page,
                        pageSize: 10,
                        totalItems: 25,
                        totalPages: 3,
                        returnedItems: 0
                    }
                })
            };
        }
    });

    AdminTickets.pageSize = 10;
    AdminTickets.pagination = {
        page: 1,
        pageSize: 10,
        totalItems: 25,
        totalPages: 3,
        hasPrevPage: false,
        hasNextPage: true,
        returnedItems: 10
    };

    return Promise.resolve()
        .then(() => AdminTickets.changePage(0))
        .then(() => {
            assert.equal(AdminTickets.currentPage, 1);
            return AdminTickets.changePage(99);
        })
        .then(() => {
            assert.equal(AdminTickets.currentPage, 3);
            assert.deepEqual(fetchPages, [1, 3]);
        });
});

test('admin tickets list URL encodes overdue and high-priority quick filters', () => {
    const { AdminTickets } = loadAdminTicketsRuntime();

    AdminTickets.quickFilters = {
        overdueOnly: true,
        priority: 'high',
        assignee: 'mine'
    };
    AdminTickets.searchQuery = 'buyer@example.com';

    const url = AdminTickets.getTicketsListUrl({
        page: 2,
        status: 'pending'
    });
    const requestUrl = new URL(url, 'http://localhost');

    assert.equal(requestUrl.searchParams.get('route'), 'tickets/list');
    assert.equal(requestUrl.searchParams.get('page'), '2');
    assert.equal(requestUrl.searchParams.get('status'), 'pending');
    assert.equal(requestUrl.searchParams.get('query'), 'buyer@example.com');
    assert.equal(requestUrl.searchParams.get('overdue'), '1');
    assert.equal(requestUrl.searchParams.get('priority'), 'high');
    assert.equal(requestUrl.searchParams.get('assignee'), 'mine');
});

test('admin tickets metrics URL uses the central admin route helper', () => {
    const { AdminTickets } = loadAdminTicketsRuntime();
    const requestUrl = new URL(AdminTickets.getTicketsMetricsUrl(), 'http://localhost');

    assert.equal(requestUrl.pathname, '/api/admin');
    assert.equal(requestUrl.searchParams.get('route'), 'tickets/metrics');
});

test('admin tickets summary actions URL uses the central admin route helper', () => {
    const { AdminTickets } = loadAdminTicketsRuntime();
    const requestUrl = new URL(AdminTickets.getTicketsSummaryActionsUrl(), 'http://localhost');

    assert.equal(requestUrl.pathname, '/api/admin');
    assert.equal(requestUrl.searchParams.get('route'), 'tickets/summary-actions');
});

test('admin tickets workspace navigation merges queue and batch into a single processing workspace', () => {
    const moduleElement = createElementStub({
        dataset: {
            ticketWorkspace: 'queue'
        }
    });
    const queueTab = createElementStub({
        dataset: {
            ticketWorkspace: 'queue'
        }
    });
    const overviewTab = createElementStub({
        dataset: {
            ticketWorkspace: 'overview'
        }
    });
    const summaryTab = createElementStub({
        dataset: {
            ticketWorkspace: 'summary'
        }
    });
    const titleNode = createElementStub();
    const subtitleNode = createElementStub();
    const { AdminTickets } = loadAdminTicketsRuntime({
        elements: {
            'module-tickets': moduleElement,
            ticketWorkspaceQueueTab: queueTab,
            ticketWorkspaceOverviewTab: overviewTab,
            ticketWorkspaceSummaryTab: summaryTab,
            ticketsWorkspaceTitle: titleNode,
            ticketsWorkspaceSubtitle: subtitleNode
        }
    });

    AdminTickets.syncTicketWorkspaceView();
    assert.equal(moduleElement.dataset.ticketWorkspace, 'queue');
    assert.equal(queueTab.classList.contains('active'), true);
    assert.equal(queueTab.attributes['aria-selected'], 'true');
    assert.equal(titleNode.textContent, '工单处理');

    const overviewView = AdminTickets.setWorkspaceView('overview', {
        scroll: false,
        highlight: false
    });
    assert.equal(overviewView, 'overview');
    assert.equal(moduleElement.dataset.ticketWorkspace, 'overview');
    assert.equal(overviewTab.classList.contains('active'), true);
    assert.equal(queueTab.classList.contains('active'), false);
    assert.equal(titleNode.textContent, 'SLA 看板');
    assert.match(subtitleNode.textContent, /处理效率/);

    const mergedBatchView = AdminTickets.setWorkspaceView('batch', {
        scroll: false,
        highlight: false
    });
    assert.equal(mergedBatchView, 'queue');
    assert.equal(moduleElement.dataset.ticketWorkspace, 'queue');
    assert.equal(queueTab.classList.contains('active'), true);
    assert.equal(titleNode.textContent, '工单处理');
    assert.match(subtitleNode.textContent, /批量动作/);

    let historyRequest = null;
    AdminTickets.resolveReminderSummaryJobEntry = (jobId = '') => (
        jobId === 'summary-nav-job-1'
            ? { id: jobId, title: '工单超时汇总（1 条）' }
            : null
    );
    AdminTickets.syncReminderSummaryJobDetailModal = () => {};
    AdminTickets.loadReminderSummaryJobHistory = (jobId, options = {}) => {
        historyRequest = {
            jobId,
            options
        };
    };

    const opened = AdminTickets.openReminderSummaryJobDetail('summary-nav-job-1');
    assert.equal(opened, true);
    assert.equal(moduleElement.dataset.ticketWorkspace, 'summary');
    assert.equal(summaryTab.classList.contains('active'), true);
    assert.equal(titleNode.textContent, '汇总追踪');
    assert.equal(AdminTickets.activeReminderSummaryJobId, 'summary-nav-job-1');
    assert.equal(historyRequest?.jobId, 'summary-nav-job-1');
    assert.equal(historyRequest?.options?.force, true);
});

test('admin tickets renderOverview splits reminder status and summary tracking by workspace', () => {
    const moduleElement = createElementStub({
        dataset: {
            ticketWorkspace: 'summary'
        }
    });
    const reminderHeading = createElementStub();
    const reminderMeta = createElementStub();
    const overviewGrid = createElementStub();
    const sourceBreakdown = createElementStub();
    const issueBreakdown = createElementStub();
    const reminderPanel = createElementStub();
    const overviewSubtitle = createElementStub();
    const overviewUpdatedAt = createElementStub();
    const { AdminTickets } = loadAdminTicketsRuntime({
        elements: {
            'module-tickets': moduleElement,
            ticketsOverviewReminderHeading: reminderHeading,
            ticketsOverviewReminderMeta: reminderMeta,
            ticketsOverviewGrid: overviewGrid,
            ticketsOverviewSourceBreakdown: sourceBreakdown,
            ticketsOverviewIssueBreakdown: issueBreakdown,
            ticketsOverviewReminderPanel: reminderPanel,
            ticketsOverviewSubtitle: overviewSubtitle,
            ticketsOverviewUpdatedAt: overviewUpdatedAt
        }
    });

    AdminTickets.overview = {
        generated_at: '2026-04-04T00:00:00.000Z',
        backlog: {
            total_pending: 1,
            unassigned_count: 1,
            high_priority_count: 0,
            overdue_count: 3,
            refundable_count: 0,
            oldest_wait_minutes: 240
        },
        efficiency: {
            lookback_days: 30
        },
        sources: [],
        issue_types: [],
        reminder: {
            enabled: true,
            ops_alerts_enabled: true,
            work_hours_only_enabled: false,
            summary_enabled: true,
            pending_overdue_minutes: 120,
            critical_overdue_minutes: 720,
            sweep_interval_minutes: 10,
            summary_schedule_mode: 'daily',
            summary_daily_hour: 9,
            summary_daily_minute: 30,
            activity: AdminTickets.buildEmptyReminderActivityOverview(),
            summary_digest: AdminTickets.buildEmptyReminderSummaryDigest()
        }
    };

    AdminTickets.syncTicketWorkspaceView('summary');
    AdminTickets.renderOverview();

    assert.equal(reminderHeading.textContent, '汇总追踪');
    assert.match(reminderMeta.textContent, /提醒活动/);
    assert.match(reminderPanel.innerHTML, /当前提醒配置/);
    assert.match(reminderPanel.innerHTML, /当前超时/);
    assert.match(reminderPanel.innerHTML, /巡检频率/);
    assert.match(reminderPanel.innerHTML, /汇总策略/);
    assert.match(reminderPanel.innerHTML, /admin-ticket-overview-reminder-summary-entry__cards/);
    assert.match(reminderPanel.innerHTML, /每日 SLA 汇总/);
    assert.match(reminderPanel.innerHTML, /提醒活动闭环/);
    assert.match(reminderPanel.innerHTML, /admin-ticket-overview-reminder-actions--embedded/);
    assert.doesNotMatch(reminderPanel.innerHTML, /提醒已开启/);

    AdminTickets.syncTicketWorkspaceView('overview');
    AdminTickets.renderOverview();

    assert.equal(reminderHeading.textContent, '超时提醒状态');
    assert.match(reminderMeta.textContent, /沿用工单告警编排/);
    assert.match(overviewGrid.innerHTML, /最老待处理/);
    assert.match(overviewGrid.innerHTML, /当前可人工退款 0 单/);
    assert.doesNotMatch(overviewGrid.innerHTML, /可直接退款/);
    assert.match(reminderPanel.innerHTML, /提醒已开启/);
    assert.doesNotMatch(reminderPanel.innerHTML, /每日 SLA 汇总/);
});

test('admin tickets workspace switch rerenders reminder panel content for summary tracking', () => {
    const moduleElement = createElementStub({
        dataset: {
            ticketWorkspace: 'overview'
        }
    });
    const reminderHeading = createElementStub();
    const reminderMeta = createElementStub();
    const overviewGrid = createElementStub();
    const sourceBreakdown = createElementStub();
    const issueBreakdown = createElementStub();
    const reminderPanel = createElementStub();
    const overviewSubtitle = createElementStub();
    const overviewUpdatedAt = createElementStub();
    const { AdminTickets } = loadAdminTicketsRuntime({
        elements: {
            'module-tickets': moduleElement,
            ticketsOverviewReminderHeading: reminderHeading,
            ticketsOverviewReminderMeta: reminderMeta,
            ticketsOverviewGrid: overviewGrid,
            ticketsOverviewSourceBreakdown: sourceBreakdown,
            ticketsOverviewIssueBreakdown: issueBreakdown,
            ticketsOverviewReminderPanel: reminderPanel,
            ticketsOverviewSubtitle: overviewSubtitle,
            ticketsOverviewUpdatedAt: overviewUpdatedAt
        }
    });

    AdminTickets.overview = {
        generated_at: '2026-04-04T00:00:00.000Z',
        backlog: {
            overdue_count: 6
        },
        efficiency: {
            lookback_days: 30
        },
        sources: [],
        issue_types: [],
        reminder: {
            enabled: true,
            ops_alerts_enabled: true,
            work_hours_only_enabled: false,
            summary_enabled: true,
            pending_overdue_minutes: 120,
            critical_overdue_minutes: 720,
            sweep_interval_minutes: 10,
            summary_schedule_mode: 'daily',
            summary_daily_hour: 9,
            summary_daily_minute: 30,
            activity: AdminTickets.buildEmptyReminderActivityOverview(),
            summary_digest: AdminTickets.buildEmptyReminderSummaryDigest()
        }
    };

    AdminTickets.syncTicketWorkspaceView('overview');
    AdminTickets.renderOverview();

    assert.equal(reminderHeading.textContent, '超时提醒状态');
    assert.match(reminderPanel.innerHTML, /提醒已开启/);
    assert.doesNotMatch(reminderPanel.innerHTML, /每日 SLA 汇总/);

    const summaryView = AdminTickets.setWorkspaceView('summary', {
        scroll: false,
        highlight: false
    });

    assert.equal(summaryView, 'summary');
    assert.equal(reminderHeading.textContent, '汇总追踪');
    assert.match(reminderMeta.textContent, /提醒活动/);
    assert.match(reminderPanel.innerHTML, /当前提醒配置/);
    assert.match(reminderPanel.innerHTML, /当前超时/);
    assert.match(reminderPanel.innerHTML, /巡检频率/);
    assert.match(reminderPanel.innerHTML, /汇总策略/);
    assert.match(reminderPanel.innerHTML, /admin-ticket-overview-reminder-summary-entry__cards/);
    assert.match(reminderPanel.innerHTML, /每日 SLA 汇总/);
    assert.match(reminderPanel.innerHTML, /提醒活动闭环/);
    assert.doesNotMatch(reminderPanel.innerHTML, /提醒已开启/);
});

test('admin tickets openOverdueQueue forces the pending overdue view without toggling other quick filters off', async () => {
    const { AdminTickets } = loadAdminTicketsRuntime();
    const loadCalls = [];

    AdminTickets.quickFilters = {
        overdueOnly: false,
        priority: 'high',
        assignee: 'mine'
    };
    AdminTickets.searchQuery = 'ticket-123';
    AdminTickets.loadTickets = async (options = {}) => {
        loadCalls.push(options);
    };

    await AdminTickets.openOverdueQueue();

    assert.equal(loadCalls.length, 1);
    assert.equal(loadCalls[0].status, 'pending');
    assert.equal(loadCalls[0].overdueOnly, true);
    assert.equal(loadCalls[0].priority, 'high');
    assert.equal(loadCalls[0].assignee, 'mine');
    assert.equal(loadCalls[0].searchQuery, 'ticket-123');
});

test('admin tickets fall back to client-side loading when the admin list route is unavailable', async () => {
    const { AdminTickets } = loadAdminTicketsRuntime({
        fetchImpl: async () => ({
            ok: false,
            status: 404,
            json: async () => ({
                success: false,
                message: 'Admin route not found'
            })
        }),
        supabaseClient: createSupabaseClientStub({
            shop_tickets: [{
                id: 'ticket-fallback-1',
                user_id: 'user-fallback-1',
                order_id: 'order-fallback-1',
                issue_type: 'REFUND',
                status: 'PENDING',
                reason: '用户申请退款',
                description: '用户申请退款，邮箱 buyer@example.com',
                admin_notes: '',
                created_at: '2026-04-03T10:00:00.000Z',
                updated_at: '2026-04-03T10:00:00.000Z'
            }],
            profiles: [{
                id: 'user-fallback-1',
                email: 'buyer@example.com'
            }],
            shop_orders: [{
                id: 'order-fallback-1',
                price_paid: 66,
                refund_status: 'none'
            }]
        }),
        elements: {
            ticketsTableBody: {
                innerHTML: '',
                replaceChildren() {}
            }
        }
    });

    AdminTickets.render = () => {};
    await AdminTickets.loadTickets({
        page: 1,
        status: 'all',
        searchQuery: 'buyer@example.com',
        showSkeleton: false
    });

    assert.equal(AdminTickets._forceClientSideListFallback, true);
    assert.equal(AdminTickets.filteredTickets.length, 1);
    assert.equal(AdminTickets.filteredTickets[0].user_email, 'buyer@example.com');
    assert.equal(AdminTickets.filteredTickets[0].refund_summary, '可退 66 积分');
    assert.equal(AdminTickets.pagination.totalItems, 1);
});

test('admin tickets overview falls back to client-side metrics when the admin route is unavailable', async () => {
    const reminderHeading = { textContent: '' };
    const reminderMeta = { textContent: '' };
    const overviewGrid = { innerHTML: '' };
    const sourceBreakdown = { innerHTML: '' };
    const issueBreakdown = { innerHTML: '' };
    const reminderPanel = { innerHTML: '' };
    const overviewSubtitle = { textContent: '' };
    const overviewUpdatedAt = { textContent: '' };
    const { AdminTickets } = loadAdminTicketsRuntime({
        fetchImpl: async () => ({
            ok: false,
            status: 404,
            json: async () => ({
                success: false,
                message: 'Admin route not found'
            })
        }),
        supabaseClient: createSupabaseClientStub({
            shop_tickets: [{
                id: 'ticket-overview-chat-1',
                user_id: 'user-overview-1',
                order_id: 'order-overview-1',
                issue_type: 'REFUND',
                status: 'PENDING',
                description: [
                    '[客服会话转工单]',
                    '告警标题：客服会话跟进（user-overview-1）',
                    '用户邮箱：buyer@example.com',
                    '会话标识：buyer@example.com'
                ].join('\n'),
                admin_notes: '',
                created_at: '2026-04-03T10:00:00.000Z',
                updated_at: '2026-04-03T10:00:00.000Z'
            }, {
                id: 'ticket-overview-ops-1',
                user_id: 'user-overview-2',
                order_id: 'order-overview-2',
                issue_type: 'DELIVERY',
                status: 'OPEN',
                description: [
                    '[站内代办转工单]',
                    '告警标题：履约失败（order-overview-2）',
                    '告警类型：shop_order_delivery_failed',
                    '订单号：order-overview-2',
                    '告警标识：shop_order_delivery:order-overview-2'
                ].join('\n'),
                admin_notes: '',
                created_at: '2026-04-03T09:00:00.000Z',
                updated_at: '2026-04-03T09:00:00.000Z'
            }, {
                id: 'ticket-overview-resolved-1',
                user_id: 'user-overview-3',
                order_id: 'order-overview-3',
                issue_type: 'REFUND',
                status: 'RESOLVED',
                description: '已完成退款处理',
                admin_notes: '',
                created_at: '2026-04-03T08:00:00.000Z',
                updated_at: '2026-04-03T11:00:00.000Z'
            }],
            profiles: [{
                id: 'user-overview-1',
                email: 'buyer@example.com'
            }, {
                id: 'user-overview-2',
                email: 'ops@example.com'
            }, {
                id: 'user-overview-3',
                email: 'closed@example.com'
            }],
            shop_orders: [{
                id: 'order-overview-1',
                price_paid: 88,
                refund_status: 'none'
            }, {
                id: 'order-overview-2',
                price_paid: 0,
                refund_status: 'none'
            }, {
                id: 'order-overview-3',
                price_paid: 66,
                refund_status: 'refunded'
            }],
            ops_alert_jobs: [{
                id: 'overview-reminder-job-overdue-1',
                alert_type: 'ticket_sla_overdue',
                severity: 'critical',
                title: '工单超时未处理（ticket-overview-chat-1）',
                payload: {
                    ticket_id: 'ticket-overview-chat-1',
                    target_id: 'ticket-overview-chat-1',
                    wait_label: '1 小时 25 分钟'
                },
                channels: ['feishu'],
                remaining_channels: [],
                status: 'delivered',
                attempt_count: 1,
                last_error: '',
                created_at: '2026-04-03T10:12:00.000Z',
                delivered_at: '2026-04-03T10:13:00.000Z'
            }, {
                id: 'overview-reminder-job-recovered-1',
                alert_type: 'ticket_sla_recovered',
                severity: 'warning',
                title: '工单超时已恢复（ticket-overview-ops-1）',
                payload: {
                    ticket_id: 'ticket-overview-ops-1',
                    target_id: 'ticket-overview-ops-1',
                    previous_wait_label: '3 小时 10 分钟'
                },
                channels: ['feishu', 'email'],
                remaining_channels: ['email'],
                status: 'retry',
                attempt_count: 2,
                last_error: 'Webhook timeout',
                created_at: '2026-04-03T11:25:00.000Z',
                delivered_at: ''
            }, {
                id: 'overview-reminder-job-summary-2',
                alert_type: 'ticket_sla_summary',
                severity: 'warning',
                title: '工单超时汇总（1 条超时工单）',
                payload: {
                    summary_schedule_mode: 'daily',
                    summary_window_minutes: 1440,
                    summary_max_items: 5,
                    summary_daily_hour: 9,
                    summary_daily_minute: 30,
                    summary_timezone: 'Asia/Shanghai',
                    window_start_at: '2026-04-01T01:30:00.000Z',
                    window_end_at: '2026-04-02T01:30:00.000Z',
                    item_count: 1,
                    entry_path: '售后工单 -> 待处理 -> 工单详情',
                    items: [{
                        alert_type: 'ticket_sla_overdue',
                        payload: {
                            ticket_id: 'ticket-overview-chat-1',
                            order_id: 'order-overview-1',
                            user_email: 'buyer@example.com',
                            wait_label: '1 小时 10 分钟',
                            ticket_status: 'PENDING',
                            responsible_label: 'ops@example.com',
                            reason: '用户再次催单',
                            updated_at: '2026-04-02T09:35:00.000Z'
                        }
                    }]
                },
                channels: ['feishu', 'email'],
                remaining_channels: ['email'],
                status: 'retry',
                attempt_count: 1,
                last_error: 'Digest webhook timeout',
                created_at: '2026-04-02T09:40:00.000Z',
                delivered_at: ''
            }, {
                id: 'overview-reminder-job-summary-1',
                alert_type: 'ticket_sla_summary',
                severity: 'critical',
                title: '工单超时汇总（2 条超时工单）',
                payload: {
                    summary_schedule_mode: 'daily',
                    summary_window_minutes: 1440,
                    summary_max_items: 5,
                    summary_daily_hour: 9,
                    summary_daily_minute: 30,
                    summary_timezone: 'Asia/Shanghai',
                    window_start_at: '2026-04-02T01:30:00.000Z',
                    window_end_at: '2026-04-03T01:30:00.000Z',
                    item_count: 2,
                    entry_path: '售后工单 -> 待处理 -> 工单详情',
                    items: [{
                        alert_type: 'ticket_sla_overdue',
                        payload: {
                            ticket_id: 'ticket-overview-chat-1',
                            order_id: 'order-overview-1',
                            user_email: 'buyer@example.com',
                            wait_label: '1 小时 25 分钟',
                            ticket_status: 'PENDING',
                            responsible_label: 'ops@example.com',
                            reason: '用户申请退款',
                            updated_at: '2026-04-03T10:12:00.000Z'
                        }
                    }, {
                        alert_type: 'ticket_sla_overdue',
                        payload: {
                            ticket_id: 'ticket-overview-ops-1',
                            order_id: 'order-overview-2',
                            user_email: 'ops@example.com',
                            wait_label: '3 小时 10 分钟',
                            ticket_status: 'PENDING',
                            responsible_label: '未分配',
                            reason: '履约失败',
                            updated_at: '2026-04-03T11:25:00.000Z'
                        }
                    }]
                },
                channels: ['feishu'],
                remaining_channels: [],
                status: 'delivered',
                attempt_count: 1,
                last_error: '',
                created_at: '2026-04-03T12:35:00.000Z',
                delivered_at: '2026-04-03T12:36:00.000Z'
            }],
            ops_alert_job_attempts: [{
                job_id: 'overview-reminder-job-overdue-1',
                channel: 'feishu',
                status: 'delivered',
                response_status: 200,
                error_message: '',
                created_at: '2026-04-03T10:13:00.000Z'
            }, {
                job_id: 'overview-reminder-job-recovered-1',
                channel: 'feishu',
                status: 'failed',
                response_status: 504,
                error_message: 'Webhook timeout',
                created_at: '2026-04-03T11:26:00.000Z'
            }, {
                job_id: 'overview-reminder-job-summary-2',
                channel: 'feishu',
                status: 'failed',
                response_status: 504,
                error_message: 'Digest webhook timeout',
                created_at: '2026-04-02T09:41:00.000Z'
            }, {
                job_id: 'overview-reminder-job-summary-1',
                channel: 'feishu',
                status: 'delivered',
                response_status: 200,
                error_message: '',
                created_at: '2026-04-03T12:36:00.000Z'
            }],
            admin_audit_logs_view: [{
                id: 'audit-overview-assign-1',
                action_type: 'ticket.assign',
                created_at: '2026-04-03T10:30:00.000Z',
                admin_id: 'admin-overview-1',
                admin_email: 'ops@example.com',
                details: {
                    ticket_id: 'ticket-overview-chat-1',
                    assigned: true,
                    assignee_id: 'admin-overview-1',
                    assignee_label: 'ops@example.com'
                }
            }, {
                id: 'audit-overview-process-1',
                action_type: 'ticket.process',
                created_at: '2026-04-03T11:00:00.000Z',
                admin_id: 'admin-overview-1',
                admin_email: 'ops@example.com',
                details: {
                    ticket_id: 'ticket-overview-resolved-1',
                    new_status: 'RESOLVED',
                    refund_outcome: 'refunded'
                }
            }, {
                id: 'audit-overview-summary-note-1',
                action_type: 'ticket.summary_job_action',
                created_at: '2026-04-03T12:40:00.000Z',
                admin_id: 'admin-overview-2',
                admin_email: 'lead@example.com',
                details: {
                    action: 'add_note',
                    job_id: 'overview-reminder-job-summary-1',
                    note: '已人工确认这条日报发送完成'
                }
            }, {
                id: 'audit-overview-summary-retry-1',
                action_type: 'ticket.summary_job_action',
                created_at: '2026-04-02T09:45:00.000Z',
                admin_id: 'admin-overview-1',
                admin_email: 'ops@example.com',
                details: {
                    action: 'request_retry',
                    job_id: 'overview-reminder-job-summary-2',
                    manual_retry_mode: 'requeue',
                    queue_previous_status: 'dead_letter',
                    queue_next_status: 'retry'
                }
            }]
        }),
        elements: {
            ticketsOverviewReminderHeading: reminderHeading,
            ticketsOverviewReminderMeta: reminderMeta,
            ticketsOverviewGrid: overviewGrid,
            ticketsOverviewSourceBreakdown: sourceBreakdown,
            ticketsOverviewIssueBreakdown: issueBreakdown,
            ticketsOverviewReminderPanel: reminderPanel,
            ticketsOverviewSubtitle: overviewSubtitle,
            ticketsOverviewUpdatedAt: overviewUpdatedAt
        }
    });
    AdminTickets.parseLinkedChatSessionContext = (description = '') => (
        String(description || '').includes('[客服会话转工单]')
            ? { session_id: 'buyer@example.com' }
            : null
    );
    AdminTickets.parseLinkedOpsAlertContext = (description = '') => (
        String(description || '').includes('[站内代办转工单]')
            ? {
                alert_type: 'shop_order_delivery_failed',
                target_id: 'order-overview-2'
            }
            : null
    );

    await AdminTickets.loadOverview({
        showSkeleton: false
    });

    assert.equal(AdminTickets._forceClientSideOverviewFallback, true);
    assert.equal(AdminTickets.overview.backlog.total_pending, 2);
    assert.equal(AdminTickets.overview.backlog.assigned_count, 1);
    assert.equal(AdminTickets.overview.backlog.unassigned_count, 1);
    assert.equal(AdminTickets.overview.backlog.refundable_count, 1);
    assert.equal(AdminTickets.overview.efficiency.closed_count, 1);
    assert.equal(AdminTickets.overview.efficiency.resolved_count, 1);
    assert.equal(AdminTickets.overview.efficiency.refund_related_count, 1);
    assert.deepEqual(
        Array.from(AdminTickets.overview.sources, (item) => item.key),
        ['chat_session', 'ops_alert']
    );
    assert.deepEqual(
        Array.from(AdminTickets.overview.issue_types, (item) => item.key),
        ['DELIVERY', 'REFUND']
    );
    assert.equal(AdminTickets.overview.reminder.enabled, true);
    assert.equal(AdminTickets.overview.reminder.activity.total_job_count, 2);
    assert.equal(AdminTickets.overview.reminder.activity.overdue_job_count, 1);
    assert.equal(AdminTickets.overview.reminder.activity.recovered_job_count, 1);
    assert.equal(AdminTickets.overview.reminder.activity.latest_job.status, 'retry');
    assert.equal(AdminTickets.overview.reminder.activity.latest_recovered.last_error, 'Webhook timeout');
    assert.equal(AdminTickets.overview.reminder.summary_digest.total_job_count, 2);
    assert.equal(AdminTickets.overview.reminder.summary_digest.daily_job_count, 2);
    assert.equal(AdminTickets.overview.reminder.summary_digest.failure_job_count, 1);
    assert.equal(AdminTickets.overview.reminder.summary_digest.latest_job.status, 'delivered');
    assert.equal(AdminTickets.overview.reminder.summary_digest.latest_job.latest_manual_event.title, '记录人工备注');
    assert.equal(AdminTickets.overview.reminder.summary_digest.latest_daily_job.item_count, 2);
    assert.equal(AdminTickets.overview.reminder.summary_digest.latest_daily_job.preview_items[0].ticket_id, 'ticket-overview-chat-1');
    assert.equal(AdminTickets.overview.reminder.summary_digest.latest_problem_job.status, 'retry');
    assert.equal(AdminTickets.overview.reminder.summary_digest.latest_problem_job.latest_manual_event.title, '人工重新加入重试队列');
    assert.equal(AdminTickets.overview.reminder.summary_digest.recent_jobs.length, 2);
    assert.match(overviewSubtitle.textContent, /最近 30 天/);
    assert.match(overviewUpdatedAt.textContent, /更新时间/);
    assert.equal(reminderHeading.textContent, '超时提醒状态');
    assert.match(reminderMeta.textContent, /沿用工单告警编排/);
    assert.match(reminderPanel.innerHTML, /提醒已开启/);
    assert.match(reminderPanel.innerHTML, /当前超时 2 单/);
    assert.match(reminderPanel.innerHTML, /巡检频率/);
    assert.match(reminderPanel.innerHTML, /汇总策略/);
    assert.doesNotMatch(reminderPanel.innerHTML, /提醒活动闭环/);
    assert.doesNotMatch(reminderPanel.innerHTML, /每日 SLA 汇总/);
});

test('admin tickets reminder telemetry keeps activity data when summary digest loading fails', async () => {
    const { AdminTickets } = loadAdminTicketsRuntime();
    AdminTickets.loadClientSideReminderActivity = async () => ({
        ...AdminTickets.buildEmptyReminderActivityOverview(),
        total_job_count: 2,
        overdue_job_count: 1
    });
    AdminTickets.loadClientSideReminderSummaryDigest = async () => {
        throw new Error('summary digest unavailable');
    };

    const telemetry = await AdminTickets.loadClientSideReminderActivityAndSummary(7);

    assert.equal(telemetry.activity.total_job_count, 2);
    assert.equal(telemetry.activity.overdue_job_count, 1);
    assert.equal(telemetry.summary_digest.total_job_count, 0);
    assert.equal(telemetry.summary_digest.recent_jobs.length, 0);
});

test('admin tickets buildReminderSummaryPreviewComparison groups added ongoing and removed preview tickets', () => {
    const { AdminTickets } = loadAdminTicketsRuntime();

    const comparison = AdminTickets.buildReminderSummaryPreviewComparison({
        id: 'summary-current',
        preview_items: [{
            ticket_id: 'ticket-a',
            reason: '用户申请退款'
        }, {
            ticket_id: 'ticket-b',
            reason: '履约失败'
        }]
    }, {
        id: 'summary-previous',
        preview_items: [{
            ticket_id: 'ticket-a',
            reason: '用户申请退款'
        }, {
            ticket_id: 'ticket-c',
            reason: '库存补发'
        }]
    });

    assert.equal(comparison.added_items.length, 1);
    assert.equal(comparison.added_items[0].ticket_id, 'ticket-b');
    assert.equal(comparison.ongoing_items.length, 1);
    assert.equal(comparison.ongoing_items[0].ticket_id, 'ticket-a');
    assert.equal(comparison.removed_items.length, 1);
    assert.equal(comparison.removed_items[0].ticket_id, 'ticket-c');
});

test('admin tickets renderReminderSummaryComparisonBucket limits ongoing tickets to a scrollable list after two cards', () => {
    const { AdminTickets } = loadAdminTicketsRuntime();

    const html = AdminTickets.renderReminderSummaryComparisonBucket('连续两次都在的工单', [{
            ticket_id: 'ticket-a'
        }, {
            ticket_id: 'ticket-b'
        }, {
            ticket_id: 'ticket-c'
        }, {
            ticket_id: 'ticket-d'
        }], {
        tone: 'warning',
        actionLabel: '继续跟进',
        scrollLimit: 2
    });

    assert.match(html, /连续两次都在的工单/);
    assert.match(html, /admin-ticket-summary-job-modal__comparison-list--limit-2/);
    assert.match(html, /admin-ticket-summary-job-modal__comparison-list--scrollable/);
});

test('admin tickets buildReminderSummaryHandoffSummary derives latest owner note and next step', () => {
    const { AdminTickets } = loadAdminTicketsRuntime();

    const summary = AdminTickets.buildReminderSummaryHandoffSummary({
        id: 'summary-handoff-1',
        status: 'dead_letter',
        remaining_channels: ['email'],
        last_error: 'Digest webhook timeout',
        manual_event_count: 2,
        latest_manual_event: {
            title: '记录人工备注',
            actor: 'lead@example.com',
            created_at: '2026-04-04T10:05:00.000Z',
            note_excerpt: '先核对邮件通道，再决定是否手动重试'
        },
        preview_items: [{
            ticket_id: 'ticket-a'
        }, {
            ticket_id: 'ticket-b'
        }]
    }, [{
        title: '记录人工备注',
        actor: 'lead@example.com',
        created_at: '2026-04-04T10:05:00.000Z',
        detail: '记录人：lead@example.com\n内部备注：先核对邮件通道，再决定是否手动重试'
    }]);

    assert.equal(summary.latest_actor, 'lead@example.com');
    assert.equal(summary.latest_action_title, '记录人工备注');
    assert.equal(summary.latest_note_excerpt, '先核对邮件通道，再决定是否手动重试');
    assert.equal(summary.manual_action_count, 2);
    assert.match(summary.next_step_title, /建议立即人工恢复重试/);
    assert.match(summary.next_step_detail, /邮件/);
    assert.match(summary.next_step_detail, /Digest webhook timeout/);
});

test('admin tickets openReminderSummaryJobDetail renders the summary detail modal from overview data', () => {
    const modal = createElementStub();
    const titleNode = createElementStub();
    const subtitleNode = createElementStub();
    const bodyNode = createElementStub();
    const retryButton = createElementStub({
        textContent: '重新加入重试队列'
    });
    const { AdminTickets } = loadAdminTicketsRuntime({
        elements: {
            ticketSummaryJobDetailModal: modal,
            ticketSummaryJobDetailTitle: titleNode,
            ticketSummaryJobDetailSubtitle: subtitleNode,
            ticketSummaryJobDetailBody: bodyNode,
            ticketSummaryJobRetryBtn: retryButton
        }
    });

    AdminTickets.overview = {
        reminder: {
            summary_digest: {
                recent_jobs: [{
                    id: 'summary-detail-job-1',
                    status: 'dead_letter',
                    severity: 'critical',
                    title: '工单超时汇总（2 条超时工单）',
                    created_at: '2026-04-04T09:00:00.000Z',
                    updated_at: '2026-04-04T10:00:00.000Z',
                    delivered_at: '',
                    attempt_count: 6,
                    max_attempts: 6,
                    next_retry_at: '',
                    channels: ['feishu', 'email'],
                    remaining_channels: ['email'],
                    last_error: 'Digest webhook timeout',
                    manual_event_count: 1,
                    latest_manual_event: {
                        title: '记录人工备注',
                        actor: 'lead@example.com',
                        created_at: '2026-04-04T10:05:00.000Z',
                        note_excerpt: '先核对邮件通道，再决定是否手动重试'
                    },
                    latest_attempt: {
                        channel: 'feishu',
                        status: 'failed',
                        response_status: 504,
                        created_at: '2026-04-04T10:00:00.000Z'
                    },
                    summary_schedule_mode: 'daily',
                    summary_window_minutes: 1440,
                    summary_daily_hour: 9,
                    summary_daily_minute: 30,
                    window_start_at: '2026-04-03T01:30:00.000Z',
                    window_end_at: '2026-04-04T01:30:00.000Z',
                    item_count: 2,
                    entry_path: '售后工单 -> 待处理 -> 工单详情',
                    preview_items: [{
                        ticket_id: 'ticket-reminder-1',
                        order_id: 'order-reminder-1',
                        user_email: 'buyer@example.com',
                        wait_label: '1 小时 30 分钟',
                        ticket_status: 'PENDING',
                        ticket_status_label: '待处理',
                        responsible_label: 'ops@example.com',
                        reason: '用户申请退款',
                        updated_at: '2026-04-04T09:45:00.000Z'
                    }, {
                        ticket_id: 'ticket-reminder-2',
                        order_id: 'order-reminder-2',
                        user_email: 'ops@example.com',
                        wait_label: '3 小时 10 分钟',
                        ticket_status: 'PENDING',
                        ticket_status_label: '待处理',
                        responsible_label: '未分配',
                        reason: '履约失败',
                        updated_at: '2026-04-04T09:20:00.000Z'
                    }]
                }, {
                    id: 'summary-detail-job-0',
                    status: 'delivered',
                    severity: 'warning',
                    title: '工单超时汇总（2 条超时工单）',
                    created_at: '2026-04-03T09:00:00.000Z',
                    updated_at: '2026-04-03T09:36:00.000Z',
                    delivered_at: '2026-04-03T09:36:00.000Z',
                    attempt_count: 1,
                    max_attempts: 6,
                    next_retry_at: '',
                    channels: ['feishu'],
                    remaining_channels: [],
                    last_error: '',
                    latest_attempt: {
                        channel: 'feishu',
                        status: 'delivered',
                        response_status: 200,
                        created_at: '2026-04-03T09:36:00.000Z'
                    },
                    summary_schedule_mode: 'daily',
                    summary_window_minutes: 1440,
                    summary_daily_hour: 9,
                    summary_daily_minute: 30,
                    window_start_at: '2026-04-02T01:30:00.000Z',
                    window_end_at: '2026-04-03T01:30:00.000Z',
                    item_count: 2,
                    entry_path: '售后工单 -> 待处理 -> 工单详情',
                    preview_items: [{
                        ticket_id: 'ticket-reminder-1',
                        order_id: 'order-reminder-1',
                        user_email: 'buyer@example.com',
                        wait_label: '1 小时 05 分钟',
                        ticket_status: 'PENDING',
                        ticket_status_label: '待处理',
                        responsible_label: 'ops@example.com',
                        reason: '用户申请退款',
                        updated_at: '2026-04-03T09:12:00.000Z'
                    }, {
                        ticket_id: 'ticket-reminder-3',
                        order_id: 'order-reminder-3',
                        user_email: 'old@example.com',
                        wait_label: '2 小时 40 分钟',
                        ticket_status: 'PENDING',
                        ticket_status_label: '待处理',
                        responsible_label: 'lead@example.com',
                        reason: '库存补发',
                        updated_at: '2026-04-03T09:10:00.000Z'
                    }]
                }]
            }
        }
    };

    const result = AdminTickets.openReminderSummaryJobDetail('summary-detail-job-1');

    assert.equal(result, true);
    assert.equal(modal.classList.contains('is-visible'), true);
    assert.equal(titleNode.textContent, '工单超时汇总（2 条超时工单）');
    assert.match(subtitleNode.textContent, /状态：进入死信/);
    assert.match(bodyNode.innerHTML, /人工交接摘要/);
    assert.match(bodyNode.innerHTML, /最近接手人/);
    assert.match(bodyNode.innerHTML, /lead@example.com/);
    assert.match(bodyNode.innerHTML, /建议立即人工恢复重试/);
    assert.match(bodyNode.innerHTML, /人工备注/);
    assert.match(bodyNode.innerHTML, /重试结果时间线/);
    assert.match(bodyNode.innerHTML, /相较上一份汇总的预览变化/);
    assert.match(bodyNode.innerHTML, /新增超时/);
    assert.match(bodyNode.innerHTML, /持续超时/);
    assert.match(bodyNode.innerHTML, /已移出预览/);
    assert.match(bodyNode.innerHTML, /生成 SLA 汇总任务/);
    assert.match(bodyNode.innerHTML, /重试诊断/);
    assert.match(bodyNode.innerHTML, /Digest webhook timeout/);
    assert.match(bodyNode.innerHTML, /ticket-reminder-1/);
    assert.match(bodyNode.innerHTML, /ticket-reminder-2/);
    assert.match(bodyNode.innerHTML, /ticket-reminder-3/);
    assert.equal(retryButton.disabled, false);
    assert.equal(retryButton.textContent, '重新加入重试队列');
    assert.equal(retryButton.dataset.summaryJobId, 'summary-detail-job-1');
});

test('admin tickets renderReminderSummaryJobDetailBody hides raw missing-route errors behind fallback copy', () => {
    const { AdminTickets } = loadAdminTicketsRuntime();

    const html = AdminTickets.renderReminderSummaryJobDetailBody({
        id: 'summary-detail-fallback-1',
        status: 'retry',
        title: '工单超时汇总（1 条超时工单）',
        summary_schedule_mode: 'hourly',
        summary_window_minutes: 60,
        summary_hourly_minute: 0,
        channels: ['email'],
        remaining_channels: ['email'],
        created_at: '2026-04-04T08:00:00.000Z',
        updated_at: '2026-04-04T08:05:00.000Z',
        next_retry_at: '2026-04-04T09:00:00.000Z',
        attempt_count: 0,
        max_attempts: 6,
        window_start_at: '2026-04-04T08:00:00.000Z',
        window_end_at: '2026-04-04T09:00:00.000Z',
        item_count: 6,
        entry_path: '售后工单 -> 待处理 -> 工单详情',
        preview_items: []
    }, {
        historyState: {
            loading: false,
            loaded: false,
            errorMessage: 'Admin route not found',
            items: []
        }
    });

    assert.match(html, /当前环境暂未接入汇总历史接口/);
    assert.doesNotMatch(html, /Admin route not found/);
});

test('admin tickets submitReply aborts refund flow when the refund confirmation is cancelled', async () => {
    let fetchCalls = 0;
    const { AdminTickets, getConfirmCalls } = loadAdminTicketsRuntime({
        confirmResult: false,
        fetchImpl: async () => {
            fetchCalls += 1;
            return { ok: true, json: async () => ({ success: true }) };
        },
        elements: {
            replyTicketId: { value: 'ticket-confirm-1' },
            replyNewStatus: { value: 'RESOLVED' },
            ticketAdminReply: { value: '补偿退款' },
            ticketRefundCheckbox: { checked: true }
        }
    });

    AdminTickets.tickets = [{
        id: 'ticket-confirm-1',
        status: 'PENDING',
        order_id: 'order-confirm-1'
    }];

    await AdminTickets.submitReply();

    assert.equal(fetchCalls, 0);
    assert.equal(getConfirmCalls().length, 1);
    assert.match(getConfirmCalls()[0], /退还订单积分/);
});

test('admin tickets submitReply sends internal notes separately from the public reply', async () => {
    const fetchPayloads = [];
    const { AdminTickets } = loadAdminTicketsRuntime({
        fetchImpl: async (_url, options = {}) => {
            fetchPayloads.push(JSON.parse(options.body || '{}'));
            return { ok: true, json: async () => ({ success: true }) };
        },
        elements: {
            replyTicketId: { value: 'ticket-note-submit-1' },
            replyNewStatus: { value: 'RESOLVED' },
            ticketAdminReply: { value: '已完成补发' },
            ticketInternalNote: { value: '命中风控规则，已人工复核' },
            ticketRefundCheckbox: { checked: false }
        }
    });

    AdminTickets.tickets = [{
        id: 'ticket-note-submit-1',
        status: 'PENDING',
        order_id: 'order-note-submit-1'
    }];
    AdminTickets.closeReplyModal = () => {};
    AdminTickets.loadTickets = async () => {};
    AdminTickets.loadOverview = async () => {};

    await AdminTickets.submitReply();

    assert.equal(fetchPayloads.length, 1);
    assert.equal(fetchPayloads[0].ticketId, 'ticket-note-submit-1');
    assert.equal(fetchPayloads[0].adminReply, '已完成补发');
    assert.equal(fetchPayloads[0].internalNote, '命中风控规则，已人工复核');
    assert.equal(fetchPayloads[0].doRefund, false);
});

test('admin tickets openReminderTicket focuses the target ticket through ticket search', async () => {
    const { AdminTickets } = loadAdminTicketsRuntime();
    let captured = null;
    AdminTickets.focusTicket = async (ticketId, options = {}) => {
        captured = {
            ticketId,
            options
        };
        return {
            opened: true,
            matched: true
        };
    };

    const result = await AdminTickets.openReminderTicket('ticket-reminder-1');

    assert.equal(result, true);
    assert.equal(captured.ticketId, 'ticket-reminder-1');
    assert.equal(captured.options.status, 'pending');
});

test('admin tickets openSlaSummarySettings routes to the summary-focused reminder settings view', () => {
    const { AdminTickets } = loadAdminTicketsRuntime();
    let capturedOptions = null;
    AdminTickets.openSlaSettings = (options = {}) => {
        capturedOptions = options;
        return true;
    };

    const result = AdminTickets.openSlaSummarySettings();

    assert.equal(result, true);
    assert.equal(capturedOptions.focus, 'summary');
});

test('admin tickets getTicketsSummaryHistoryUrl builds the central admin route for summary history', () => {
    const { AdminTickets } = loadAdminTicketsRuntime();

    assert.equal(
        AdminTickets.getTicketsSummaryHistoryUrl('summary-history-job-1'),
        '/api/admin?route=tickets%2Fsummary-history&jobId=summary-history-job-1'
    );
});

test('admin tickets submitReminderSummaryRetry posts the request through the ticket summary action route', async () => {
    const fetchCalls = [];
    const modal = createElementStub();
    const titleNode = createElementStub();
    const subtitleNode = createElementStub();
    const bodyNode = createElementStub();
    const retryButton = createElementStub({
        textContent: '立即再试一次'
    });
    const { AdminTickets } = loadAdminTicketsRuntime({
        fetchImpl: async (url, options = {}) => {
            fetchCalls.push({
                url,
                body: JSON.parse(options.body || '{}')
            });
            return {
                ok: true,
                json: async () => ({
                    success: true,
                    message: '已提前触发这条汇总的下一次重试'
                })
            };
        },
        elements: {
            ticketSummaryJobDetailModal: modal,
            ticketSummaryJobDetailTitle: titleNode,
            ticketSummaryJobDetailSubtitle: subtitleNode,
            ticketSummaryJobDetailBody: bodyNode,
            ticketSummaryJobRetryBtn: retryButton
        }
    });

    AdminTickets.overview = {
        reminder: {
            summary_digest: {
                recent_jobs: [{
                    id: 'summary-retry-job-1',
                    status: 'retry',
                    severity: 'warning',
                    title: '工单超时汇总（1 条超时工单）',
                    created_at: '2026-04-04T09:00:00.000Z',
                    updated_at: '2026-04-04T09:40:00.000Z',
                    delivered_at: '',
                    attempt_count: 2,
                    max_attempts: 6,
                    next_retry_at: '2026-04-04T10:00:00.000Z',
                    channels: ['feishu'],
                    remaining_channels: ['feishu'],
                    last_error: 'Digest webhook timeout',
                    latest_attempt: {
                        channel: 'feishu',
                        status: 'failed',
                        response_status: 504,
                        created_at: '2026-04-04T09:40:00.000Z'
                    },
                    summary_schedule_mode: 'daily',
                    summary_window_minutes: 1440,
                    summary_daily_hour: 9,
                    summary_daily_minute: 30,
                    window_start_at: '2026-04-03T01:30:00.000Z',
                    window_end_at: '2026-04-04T01:30:00.000Z',
                    item_count: 1,
                    entry_path: '售后工单 -> 待处理 -> 工单详情',
                    preview_items: []
                }]
            }
        }
    };
    AdminTickets.activeReminderSummaryJobId = 'summary-retry-job-1';
    AdminTickets.loadOverview = async () => {};

    const result = await AdminTickets.submitReminderSummaryRetry('summary-retry-job-1');
    const actionCalls = fetchCalls.filter((call) => /route=tickets%2Fsummary-actions/.test(call.url));
    const historyCalls = fetchCalls.filter((call) => /route=tickets%2Fsummary-history/.test(call.url));

    assert.equal(result, true);
    assert.equal(actionCalls.length, 1);
    assert.equal(historyCalls.length, 1);
    assert.equal(actionCalls[0].body.jobId, 'summary-retry-job-1');
    assert.equal(actionCalls[0].body.action, 'request_retry');
});

test('admin tickets submitReminderSummaryNote posts note actions and refreshes the summary history timeline', async () => {
    const fetchCalls = [];
    const modal = createElementStub();
    const titleNode = createElementStub();
    const subtitleNode = createElementStub();
    const bodyNode = createElementStub();
    const retryButton = createElementStub({
        textContent: '立即再试一次'
    });
    const noteInput = createElementStub({
        value: '已联系值班同学排查邮件通道'
    });
    const { AdminTickets } = loadAdminTicketsRuntime({
        fetchImpl: async (url, options = {}) => {
            fetchCalls.push({
                url,
                method: options.method || 'GET',
                body: options.body ? JSON.parse(options.body || '{}') : null
            });

            if (url.includes('route=tickets%2Fsummary-actions')) {
                return {
                    ok: true,
                    json: async () => ({
                        success: true,
                        message: '已记录人工备注'
                    })
                };
            }

            if (url.includes('route=tickets%2Fsummary-history')) {
                return {
                    ok: true,
                    json: async () => ({
                        success: true,
                        items: [{
                            id: 'history-note-1',
                            title: '记录人工备注',
                            detail: '记录人：ops@example.com\n内部备注：已联系值班同学排查邮件通道',
                            created_at: '2026-04-04T10:05:00.000Z',
                            icon: 'fa-note-sticky',
                            tone: ''
                        }]
                    })
                };
            }

            return {
                ok: true,
                json: async () => ({ success: true })
            };
        },
        elements: {
            ticketSummaryJobDetailModal: modal,
            ticketSummaryJobDetailTitle: titleNode,
            ticketSummaryJobDetailSubtitle: subtitleNode,
            ticketSummaryJobDetailBody: bodyNode,
            ticketSummaryJobRetryBtn: retryButton,
            ticketSummaryJobNoteInput: noteInput
        }
    });

    AdminTickets.overview = {
        reminder: {
            summary_digest: {
                recent_jobs: [{
                    id: 'summary-note-job-1',
                    status: 'retry',
                    severity: 'warning',
                    title: '工单超时汇总（1 条超时工单）',
                    created_at: '2026-04-04T09:00:00.000Z',
                    updated_at: '2026-04-04T09:40:00.000Z',
                    delivered_at: '',
                    attempt_count: 2,
                    max_attempts: 6,
                    next_retry_at: '2026-04-04T10:20:00.000Z',
                    channels: ['feishu'],
                    remaining_channels: ['feishu'],
                    last_error: 'Digest webhook timeout',
                    latest_attempt: {
                        channel: 'feishu',
                        status: 'failed',
                        response_status: 504,
                        created_at: '2026-04-04T09:40:00.000Z'
                    },
                    summary_schedule_mode: 'daily',
                    summary_window_minutes: 1440,
                    summary_daily_hour: 9,
                    summary_daily_minute: 30,
                    window_start_at: '2026-04-03T01:30:00.000Z',
                    window_end_at: '2026-04-04T01:30:00.000Z',
                    item_count: 1,
                    entry_path: '售后工单 -> 待处理',
                    preview_items: []
                }]
            }
        }
    };

    AdminTickets.openReminderSummaryJobDetail('summary-note-job-1');
    await AdminTickets.submitReminderSummaryNote('summary-note-job-1');

    const postCalls = fetchCalls.filter((call) => call.url.includes('route=tickets%2Fsummary-actions'));
    const historyCalls = fetchCalls.filter((call) => call.url.includes('route=tickets%2Fsummary-history'));

    assert.equal(postCalls.length, 1);
    assert.equal(postCalls[0].body.jobId, 'summary-note-job-1');
    assert.equal(postCalls[0].body.action, 'add_note');
    assert.equal(postCalls[0].body.note, '已联系值班同学排查邮件通道');
    assert.equal(historyCalls.length >= 1, true);
    assert.equal(noteInput.value, '');
    assert.match(bodyNode.innerHTML, /记录人工备注/);
    assert.match(bodyNode.innerHTML, /已联系值班同学排查邮件通道/);
});

test('admin tickets submitBulkAssignment posts pending selected ids to the assignment route', async () => {
    const fetchCalls = [];
    const { AdminTickets } = loadAdminTicketsRuntime({
        fetchImpl: async (url, options = {}) => {
            fetchCalls.push({
                url,
                body: JSON.parse(options.body || '{}')
            });
            return {
                ok: true,
                json: async () => ({
                    success: true,
                    changedCount: 1
                })
            };
        }
    });

    AdminTickets.selectedTicketIds = ['ticket-bulk-1', 'ticket-bulk-2'];
    AdminTickets.filteredTickets = [{
        id: 'ticket-bulk-1',
        status: 'PENDING'
    }, {
        id: 'ticket-bulk-2',
        status: 'RESOLVED'
    }];
    AdminTickets.loadTickets = async () => {};
    AdminTickets.loadOverview = async () => {};

    await AdminTickets.submitBulkAssignment('assign_self');

    assert.equal(fetchCalls.length, 1);
    assert.match(fetchCalls[0].url, /route=tickets%2Fassign/);
    assert.deepEqual(fetchCalls[0].body.ticketIds, ['ticket-bulk-1']);
    assert.equal(fetchCalls[0].body.operation, 'assign_self');
});

test('admin tickets submitBulkProcess posts selected ids through the batch process route', async () => {
    const fetchCalls = [];
    const { AdminTickets } = loadAdminTicketsRuntime({
        fetchImpl: async (url, options = {}) => {
            fetchCalls.push({
                url,
                body: JSON.parse(options.body || '{}')
            });
            return {
                ok: true,
                json: async () => ({
                    success: true,
                    processedCount: 2,
                    skippedCount: 0,
                    failedCount: 0
                })
            };
        },
        elements: {
            ticketBulkNewStatus: { value: 'RESOLVED' },
            ticketBulkAdminReply: { value: '当前问题已统一处理完成' },
            ticketBulkInternalNote: { value: '批量处理自夜间清队列' },
            ticketBulkProcessSubmitBtn: { disabled: false, innerHTML: '<span>确认</span>' }
        }
    });

    AdminTickets.selectedTicketIds = ['ticket-bulk-process-1', 'ticket-bulk-process-2'];
    AdminTickets.filteredTickets = [{
        id: 'ticket-bulk-process-1',
        status: 'PENDING'
    }, {
        id: 'ticket-bulk-process-2',
        status: 'PENDING'
    }];
    AdminTickets.closeBulkProcessModal = () => {};
    AdminTickets.loadTickets = async () => {};
    AdminTickets.loadOverview = async () => {};

    await AdminTickets.submitBulkProcess();

    assert.equal(fetchCalls.length, 1);
    assert.match(fetchCalls[0].url, /route=tickets%2Fbatch-process/);
    assert.deepEqual(fetchCalls[0].body.ticketIds, ['ticket-bulk-process-1', 'ticket-bulk-process-2']);
    assert.equal(fetchCalls[0].body.adminReply, '当前问题已统一处理完成');
    assert.equal(fetchCalls[0].body.internalNote, '批量处理自夜间清队列');
});
