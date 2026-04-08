const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const adminWorkbenchPath = path.resolve(__dirname, '../js/admin-workbench.js');

function loadAdminWorkbenchRuntime() {
    const script = fs.readFileSync(adminWorkbenchPath, 'utf8');
    const window = {
        setTimeout(handler) {
            if (typeof handler === 'function') {
                handler();
            }
            return 1;
        },
        requestAnimationFrame(handler) {
            if (typeof handler === 'function') {
                handler();
            }
            return 1;
        },
        addEventListener() {},
        removeEventListener() {},
        showToast() {}
    };
    const context = {
        console: {
            log() {},
            warn() {},
            error() {}
        },
        document: {
            readyState: 'loading',
            getElementById() {
                return null;
            },
            querySelector() {
                return null;
            }
        },
        window,
        globalThis: window
    };

    window.window = window;
    window.document = context.document;
    window.localStorage = {
        getItem() {
            return null;
        },
        setItem() {},
        removeItem() {}
    };

    vm.runInNewContext(script, context);
    return window;
}

test('shared admin workbench builds payment user focus payloads', () => {
    const runtime = loadAdminWorkbenchRuntime();
    const entry = runtime.buildPaymentWorkbenchEntry({
        userId: 'user_123',
        email: 'ops@example.com',
        paymentOrderId: 'pay_456',
        packageName: 'Premium'
    });

    assert.deepEqual(JSON.parse(JSON.stringify(entry)), {
        workspaceKey: 'shop-risk-users',
        context: {
            userId: 'user_123',
            email: 'ops@example.com',
            paymentOrderId: 'pay_456',
            targetId: 'user_123',
            target_id: 'user_123',
            referenceLabel: '支付单',
            referenceValue: 'pay_456',
            defaultTab: 'payments',
            tab: 'payments'
        }
    });
});

test('shared admin workbench builds linked ticket chat payloads', () => {
    const runtime = loadAdminWorkbenchRuntime();
    const entry = runtime.buildTicketWorkbenchEntry('chat', {
        id: 'ticket_123',
        status: 'PENDING',
        user_id: 'user_123',
        user_email: 'fallback@example.com'
    }, {
        linkedChatContext: {
            session_id: 'session_789',
            user_email: 'chat@example.com'
        }
    });

    assert.deepEqual(JSON.parse(JSON.stringify(entry)), {
        workspaceKey: 'chat-session',
        context: {
            sessionId: 'session_789',
            session_id: 'session_789',
            email: 'chat@example.com',
            userId: 'user_123',
            referenceLabel: '会话ID',
            referenceValue: 'session_789',
            targetId: 'ticket_123',
            target_id: 'ticket_123',
            ticketId: 'ticket_123',
            ticketStatus: 'PENDING'
        }
    });
});

test('shared admin workbench resolves linked ops alert sources and skips self-loop ticket targets', () => {
    const runtime = loadAdminWorkbenchRuntime();
    const sourceEntry = runtime.buildLinkedOpsAlertSourceWorkbenchEntry({
        alert_type: 'shop_order_risk_anomaly',
        category_key: 'shop_risk',
        target_id: 'shop_order_risk:coupon:SPRING2026',
        reference_label: '优惠码',
        reference_value: 'SPRING2026'
    }, {
        ticketId: 'ticket_123',
        ticketStatus: 'pending'
    });

    assert.deepEqual(JSON.parse(JSON.stringify(sourceEntry)), {
        workspaceKey: 'shop-risk-discounts',
        label: '优惠券码',
        icon: 'fas fa-ticket',
        context: {
            alertType: 'shop_order_risk_anomaly',
            targetId: 'shop_order_risk:coupon:SPRING2026',
            target_id: 'shop_order_risk:coupon:SPRING2026',
            referenceLabel: '优惠码',
            referenceValue: 'SPRING2026',
            ticketId: 'ticket_123',
            ticketStatus: 'pending'
        }
    });

    const selfLoopEntry = runtime.buildLinkedOpsAlertSourceWorkbenchEntry({
        alert_type: 'ticket_sla_overdue',
        category_key: 'tickets',
        target_id: 'ticket:ticket_123',
        reference_label: '工单号',
        reference_value: 'ticket_123'
    }, {
        ticketId: 'ticket_123',
        ticketStatus: 'pending'
    });

    assert.equal(selfLoopEntry, null);
});

test('shared admin workbench formats case summaries and recent events through a unified protocol', () => {
    const runtime = loadAdminWorkbenchRuntime();
    const summary = runtime.getOpsAlertCaseSummaryText({
        case_status: 'resolved',
        case_owner_label: '夜班值守',
        case_resolution: '已人工复核完成',
        case_latest_event_action: 'batch_mute',
        case_latest_event_label: '批量静默',
        case_latest_event_summary: '',
        case_latest_event_at: '2026-04-01T10:00:00.000Z',
        case_recent_events: [{
            action: 'batch_mute',
            action_label: '批量静默',
            summary: '',
            owner_label: '夜班值守',
            actor_label: '系统',
            created_at: '2026-04-01T10:00:00.000Z',
            metadata: {
                mute_until: '2026-04-01T12:00:00.000Z'
            }
        }]
    }, {
        formatTime: (value) => `FMT:${value}`,
        muteVerb: '已静默至'
    });

    assert.equal(summary, '已关闭 · 负责人 夜班值守 · 关闭：已人工复核完成 · 最近批量静默：已静默至 FMT:2026-04-01T12:00:00.000Z · FMT:2026-04-01T10:00:00.000Z');

    const eventText = runtime.getOpsAlertCaseRecentEventText({
        action: 'assign',
        action_label: '转交负责人',
        owner_label: '白班值守',
        actor_label: '系统',
        created_at: '2026-04-01T09:00:00.000Z'
    }, {
        formatTime: (value) => `FMT:${value}`
    });

    assert.equal(eventText, '转交负责人 · 负责人 白班值守 · 操作人 系统 · FMT:2026-04-01T09:00:00.000Z');
});

test('shared admin workbench formats linked context labels and batch previews', () => {
    const runtime = loadAdminWorkbenchRuntime();
    const singleLabel = runtime.getOpsAlertWorkspaceContextLabel({
        referenceLabel: '订单号',
        referenceValue: 'ORDER-1',
        title: 'ignored'
    }, {
        fallback: '集中告警'
    });
    assert.equal(singleLabel, '订单号：ORDER-1');

    const batchPreview = runtime.getOpsAlertWorkspaceBatchPreview([
        { reference_label: '订单号', reference_value: 'ORDER-1' },
        { reference_label: '用户', reference_value: 'USER-2' },
        { title: '库存不足' },
        { target_id: 'fallback-target' }
    ], {
        fallback: '告警',
        formatCount: (value) => `#${value}`
    });

    assert.equal(batchPreview, '订单号：ORDER-1 / 用户：USER-2 / 库存不足 等 #1 条');
});

test('shared admin workbench builds case composer meta and mutation requests', () => {
    const runtime = loadAdminWorkbenchRuntime();
    const meta = runtime.getOpsAlertCaseComposerMeta({
        action: 'assign',
        mode: 'batch',
        context: {
            caseOwnerLabel: '夜班值守'
        },
        items: [
            { reference_label: '订单号', reference_value: 'ORDER-1' },
            { reference_label: '用户', reference_value: 'USER-2' }
        ]
    }, {
        formatCount: (value) => `#${value}`,
        singleFallback: '集中告警',
        batchPreviewFallback: '告警'
    });

    assert.deepEqual(JSON.parse(JSON.stringify(meta)), {
        title: '批量指派集中告警负责人',
        summary: '当前筛选命中 #2 条告警 · 订单号：ORDER-1 / 用户：USER-2',
        description: '为当前筛选结果选择统一负责人；可选填写交接备注，便于值班交班和后续跟踪。',
        fieldLabel: '交接备注（可选）',
        placeholder: '例如：已完成首轮排查，后续由新的值班同学继续跟进。',
        submitLabel: '批量指派'
    });

    const request = runtime.buildOpsAlertCaseMutationRequest('assign', {
        category: 'shop_risk',
        alertType: 'shop_order_risk_anomaly',
        referenceLabel: '订单号',
        referenceValue: 'ORDER-1',
        targetId: 'shop_order_risk:coupon:ORDER-1',
        signalType: 'coupon',
        title: '风险订单'
    }, {
        items: [
            { category_key: 'shop_risk', target_id: 'shop_order_risk:coupon:ORDER-1', reference_label: '订单号', reference_value: 'ORDER-1' },
            { category_key: 'shop_risk', target_id: 'shop_order_risk:user_velocity:USER-2', reference_label: '用户', reference_value: 'USER-2' }
        ],
        note: '交接说明',
        ownerAdminId: 'admin_1',
        ownerLabel: '夜班值守'
    });

    assert.deepEqual(JSON.parse(JSON.stringify(request)), {
        action: 'assign',
        note: '交接说明',
        resolution: '',
        metadata: {
            alert_type: 'shop_order_risk_anomaly',
            category: 'shop_risk',
            reference_label: '订单号',
            reference_value: 'ORDER-1',
            signal_type: 'coupon',
            title: '风险订单'
        },
        items: [
            {
                category_key: 'shop_risk',
                target_id: 'shop_order_risk:coupon:ORDER-1',
                alert_type: '',
                title: '',
                reference_label: '订单号',
                reference_value: 'ORDER-1'
            },
            {
                category_key: 'shop_risk',
                target_id: 'shop_order_risk:user_velocity:USER-2',
                alert_type: '',
                title: '',
                reference_label: '用户',
                reference_value: 'USER-2'
            }
        ],
        owner_admin_id: 'admin_1',
        owner_label: '夜班值守'
    });
});

test('shared admin workbench submits case mutation requests and preserves metadata payloads', async () => {
    const runtime = loadAdminWorkbenchRuntime();
    const calls = [];
    const payload = await runtime.submitOpsAlertCaseMutationRequest({
        Authorization: 'Bearer test',
        'Content-Type': 'application/json'
    }, 'assign', {
        category: 'shop_risk',
        alertType: 'shop_order_risk_anomaly',
        referenceLabel: '订单号',
        referenceValue: 'ORDER-1',
        targetId: 'shop_order_risk:coupon:ORDER-1',
        title: '风险订单'
    }, {
        note: '交接说明',
        ownerAdminId: 'admin_1',
        ownerLabel: '夜班值守',
        metadata: {
            source: 'admin_chat_toolbar_batch_assign'
        },
        items: [{
            category_key: 'shop_risk',
            target_id: 'shop_order_risk:coupon:ORDER-1',
            reference_label: '订单号',
            reference_value: 'ORDER-1',
            metadata: {
                source: 'toolbar',
                priority: 'high'
            }
        }],
        fetch: async (url, init) => {
            calls.push({ url, init });
            return {
                ok: true,
                async json() {
                    return {
                        success: true,
                        case: {
                            id: 'case_1'
                        }
                    };
                }
            };
        }
    });

    assert.equal(payload.success, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/admin/settings/ops-alert-monitor-cases');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer test');

    const requestBody = JSON.parse(calls[0].init.body);
    assert.deepEqual(requestBody.metadata, {
        alert_type: 'shop_order_risk_anomaly',
        category: 'shop_risk',
        reference_label: '订单号',
        reference_value: 'ORDER-1',
        signal_type: '',
        title: '风险订单',
        source: 'admin_chat_toolbar_batch_assign'
    });
    assert.deepEqual(requestBody.items, [{
        category_key: 'shop_risk',
        target_id: 'shop_order_risk:coupon:ORDER-1',
        alert_type: '',
        title: '',
        reference_label: '订单号',
        reference_value: 'ORDER-1',
        metadata: {
            source: 'toolbar',
            priority: 'high'
        }
    }]);
});

test('shared admin workbench derives monitor batch items and mute module keys from prepared categories', () => {
    const runtime = loadAdminWorkbenchRuntime();
    const categories = [
        {
            key: 'payments',
            visible_items: [
                {
                    target_id: 'payment_order:PAY-1',
                    reference_label: '支付单',
                    reference_value: 'PAY-1',
                    case_status: 'open'
                },
                {
                    target_id: 'payment_order:PAY-2',
                    reference_label: '支付单',
                    reference_value: 'PAY-2',
                    case_status: 'resolved'
                }
            ]
        },
        {
            key: 'shop_risk',
            visible_items: [
                {
                    target_id: 'shop_order_risk:coupon:SPRING2026',
                    reference_label: '优惠码',
                    reference_value: 'SPRING2026',
                    case_status: 'claimed'
                }
            ]
        }
    ];

    const assignItems = runtime.buildAdminWorkbenchOpsAlertMonitorBatchItems(categories, 'assign');
    assert.deepEqual(JSON.parse(JSON.stringify(assignItems)), [
        {
            category_key: 'payments',
            target_id: 'payment_order:PAY-1',
            alert_type: '',
            title: '',
            reference_label: '支付单',
            reference_value: 'PAY-1'
        },
        {
            category_key: 'shop_risk',
            target_id: 'shop_order_risk:coupon:SPRING2026',
            alert_type: '',
            title: '',
            reference_label: '优惠码',
            reference_value: 'SPRING2026'
        }
    ]);

    const reopenItems = runtime.buildAdminWorkbenchOpsAlertMonitorBatchItems(categories, 'reopen');
    assert.deepEqual(JSON.parse(JSON.stringify(reopenItems)), [
        {
            category_key: 'payments',
            target_id: 'payment_order:PAY-2',
            alert_type: '',
            title: '',
            reference_label: '支付单',
            reference_value: 'PAY-2'
        }
    ]);

    const muteModuleKeys = runtime.getAdminWorkbenchOpsAlertMonitorBatchMuteModuleKeys(categories);
    assert.deepEqual(JSON.parse(JSON.stringify(muteModuleKeys)), ['payments', 'shop_risk']);
});

test('shared admin workbench builds ops alert monitor checklist rows and copy text', () => {
    const runtime = loadAdminWorkbenchRuntime();
    const categories = [
        {
            key: 'payments',
            label: '支付与退款',
            visible_items: [
                {
                    severity: 'critical',
                    alert_type: 'payment_refund_ops',
                    title: '退款重试堆积',
                    message: '需要人工介入',
                    reference_label: '支付单',
                    reference_value: 'PAY-1',
                    created_at: '2026-04-01T08:00:00.000Z',
                    target_id: 'pay_1'
                }
            ]
        },
        {
            key: 'inventory',
            label: '库存与补货',
            visible_items: [],
            latest_state: 'recovered',
            latest_title: '库存告警已恢复',
            latest_message: '已完成补货',
            latest_at: '2026-04-01T09:00:00.000Z'
        }
    ];

    const rows = runtime.buildAdminWorkbenchOpsAlertMonitorBatchRows(categories, { scope: 'all' }, '', {
        resolveCategoryFallbackAction: (category) => (
            String(category?.key || '') === 'inventory'
                ? { target: 'shop-inventory', label: '进入库存页' }
                : {}
        ),
        resolveItemAction: (category, item) => (
            String(category?.key || '') === 'payments' && String(item?.target_id || '') === 'pay_1'
                ? { target: 'payments-ops', label: '处理退款' }
                : {}
        ),
        getWorkspaceLabel: (target) => ({
            'payments-ops': '支付异常运维',
            'shop-inventory': '库存 / 补货'
        }[target] || target)
    });

    assert.deepEqual(JSON.parse(JSON.stringify(rows)), [
        {
            模块: '支付与退款',
            状态: '待处理',
            级别: 'critical',
            告警类型: 'payment_refund_ops',
            标题: '退款重试堆积',
            摘要: '需要人工介入',
            引用标签: '支付单',
            引用值: 'PAY-1',
            处理动作: '处理退款',
            处理入口: '支付异常运维',
            入口标识: 'payments-ops',
            创建时间: '2026-04-01T08:00:00.000Z',
            目标标识: 'pay_1'
        },
        {
            模块: '库存与补货',
            状态: '已恢复',
            级别: 'recovered',
            告警类型: 'recovered',
            标题: '库存告警已恢复',
            摘要: '已完成补货',
            引用标签: '',
            引用值: '',
            处理动作: '进入库存页',
            处理入口: '库存 / 补货',
            入口标识: 'shop-inventory',
            创建时间: '2026-04-01T09:00:00.000Z',
            目标标识: ''
        }
    ]);

    const text = runtime.buildAdminWorkbenchOpsAlertMonitorChecklistText(rows, {
        scope: 'all',
        severity: 'all',
        category: 'payments'
    }, 'payments', {
        now: '2026-04-01T10:00:00.000Z',
        formatDateTime: (value) => `FMT:${value}`,
        formatCount: (value) => `#${value}`,
        getFilterSummaryLabel: () => '全部状态 · 全部级别 · 支付与退款'
    });

    assert.match(text, /第一阶段集中告警处理清单/);
    assert.match(text, /生成时间：FMT:2026-04-01T10:00:00.000Z/);
    assert.match(text, /当前模块：支付与退款/);
    assert.match(text, /命中记录：#2 条/);
    assert.match(text, /\[支付与退款\] 退款重试堆积/);
});

test('shared admin workbench builds ops alert monitor filter summary, category view, and owned category state', () => {
    const runtime = loadAdminWorkbenchRuntime();
    const filters = {
        scope: 'active',
        severity: 'critical',
        category: 'payments'
    };
    const summaryLabel = runtime.getAdminWorkbenchOpsAlertMonitorFilterSummaryLabel(filters);
    assert.equal(summaryLabel, '仅待处理 · 仅 critical · 支付与退款');

    const categoryView = runtime.buildAdminWorkbenchOpsAlertMonitorCategoryView({
        key: 'payments',
        label: '支付与退款',
        latest_state: 'open',
        active_count: 3,
        critical_count: 2,
        items: [
            { severity: 'critical', title: '退款重试', message: 'A' },
            { severity: 'warning', title: '支付抖动', message: 'B' },
            { severity: 'critical', title: '回调延迟', message: 'C' },
            { severity: 'critical', title: '补单失败', message: 'D' }
        ]
    }, filters, {
        formatCount: (value) => `#${value}`
    });

    assert.deepEqual(JSON.parse(JSON.stringify(categoryView)), {
        key: 'payments',
        label: '支付与退款',
        latest_state: 'open',
        active_count: 3,
        critical_count: 2,
        items: [
            { severity: 'critical', title: '退款重试', message: 'A' },
            { severity: 'critical', title: '回调延迟', message: 'C' },
            { severity: 'critical', title: '补单失败', message: 'D' }
        ],
        visible_items: [
            { severity: 'critical', title: '退款重试', message: 'A' },
            { severity: 'critical', title: '回调延迟', message: 'C' },
            { severity: 'critical', title: '补单失败', message: 'D' }
        ],
        hidden_item_count: 0,
        display_active_count: 3,
        display_critical_count: 3,
        filtered_note: ''
    });

    const ownedCategories = runtime.buildAdminWorkbenchOpsAlertMonitorShiftOwnedCategoryItems([
        {
            key: 'payments',
            label: '支付与退款',
            items: [
                { case_owner_admin_id: 'admin_1', case_status: 'claimed', severity: 'critical' },
                { case_owner_admin_id: 'admin_1', case_status: 'open', severity: 'warning' },
                { case_owner_admin_id: 'admin_2', case_status: 'open', severity: 'critical' }
            ]
        },
        {
            key: 'tickets',
            label: '工单与售后',
            items: [
                { case_owner_admin_id: 'admin_1', case_status: 'open', severity: 'warning' }
            ]
        }
    ], 'admin_1', {
        locale: 'zh-CN'
    });

    assert.deepEqual(JSON.parse(JSON.stringify(ownedCategories)), [
        {
            key: 'payments',
            label: '支付与退款',
            backlog_count: 2,
            pending_count: 1,
            claimed_count: 1,
            critical_count: 1
        },
        {
            key: 'tickets',
            label: '工单与售后',
            backlog_count: 1,
            pending_count: 1,
            claimed_count: 0,
            critical_count: 0
        }
    ]);
});

test('shared admin workbench builds ops alert monitor card, panel, and batch mute modal state', () => {
    const runtime = loadAdminWorkbenchRuntime();
    const filters = {
        scope: 'all',
        severity: 'warning',
        category: 'payments'
    };
    const categories = [
        {
            key: 'payments',
            label: '支付与退款',
            description: '聚合支付、退款、回调异常',
            latest_state: 'open',
            latest_title: '退款重试堆积',
            latest_at: '2026-04-01T09:00:00.000Z',
            latest_message: '近 15 分钟回调重试明显升高',
            display_active_count: 3,
            display_critical_count: 1,
            hidden_item_count: 2,
            case_summary: {
                claimed: 2
            }
        }
    ];

    const cardState = runtime.buildAdminWorkbenchOpsAlertMonitorCategoryCardState(categories[0], filters, {
        formatCount: (value) => `#${value}`,
        formatDateTime: (value) => `FMT:${value}`,
        getCategoryActions: () => [{ target: 'payments-orders', label: '查看订单', icon: 'fas fa-credit-card' }]
    });

    assert.deepEqual(JSON.parse(JSON.stringify(cardState)), {
        tone: 'danger',
        title: '支付与退款',
        description: '聚合支付、退款、回调异常',
        latestSummary: '退款重试堆积 · FMT:2026-04-01T09:00:00.000Z',
        latestMessage: '近 15 分钟回调重试明显升高',
        emptyMessage: '当前筛选条件下没有命中的 warning 告警。',
        hiddenHint: '当前卡片仅展示前 3 项，另有 #2 项可通过“复制清单 / 导出 CSV”带走处理。',
        statBadges: [
            { label: '#3 待关注', tone: 'warning' },
            { label: '#2 处理中', tone: 'neutral' },
            { label: '#1 critical', tone: 'danger' }
        ],
        actions: [{ target: 'payments-orders', label: '查看订单', icon: 'fas fa-credit-card' }]
    });

    const categoryRenderState = runtime.buildAdminWorkbenchOpsAlertMonitorCategoryRenderState({
        ...categories[0],
        items: [
            {
                severity: 'warning',
                title: '退款重试堆积',
                message: '近 15 分钟回调重试明显升高',
                reference_label: '支付单',
                reference_value: 'PAY-1',
                created_at: '2026-04-01T09:00:00.000Z'
            }
        ]
    }, filters, {
        formatCount: (value) => `#${value}`,
        formatDateTime: (value) => `FMT:${value}`,
        getCategoryActions: () => [{ target: 'payments-orders', label: '查看订单', icon: 'fas fa-credit-card' }],
        getItemDisplayState: (item) => ({
            title: item.title,
            message: item.message,
            topBadges: [{ label: 'warning', tone: 'warning' }],
            progressPrefix: '处理进度',
            progressText: '',
            historyItems: [],
            autoResponseSummary: '',
            responseSummary: '',
            metaText: '支付单：PAY-1 · FMT:2026-04-01T09:00:00.000Z',
            hasActions: false,
            caseActions: [],
            quickAction: null,
            workspaceAction: null
        })
    });

    assert.deepEqual(JSON.parse(JSON.stringify(categoryRenderState)), {
        key: 'payments',
        tone: 'danger',
        title: '支付与退款',
        description: '聚合支付、退款、回调异常',
        latestSummary: '退款重试堆积 · FMT:2026-04-01T09:00:00.000Z',
        latestMessage: '近 15 分钟回调重试明显升高',
        emptyMessage: '当前筛选条件下没有命中的 warning 告警。',
        hiddenHint: '当前卡片仅展示前 3 项，另有 #2 项可通过“复制清单 / 导出 CSV”带走处理。',
        statBadges: [
            { label: '#3 待关注', tone: 'warning' },
            { label: '#2 处理中', tone: 'neutral' },
            { label: '#1 critical', tone: 'danger' }
        ],
        items: [
            {
                item: {
                    severity: 'warning',
                    title: '退款重试堆积',
                    message: '近 15 分钟回调重试明显升高',
                    reference_label: '支付单',
                    reference_value: 'PAY-1',
                    created_at: '2026-04-01T09:00:00.000Z'
                },
                state: {
                    title: '退款重试堆积',
                    message: '近 15 分钟回调重试明显升高',
                    topBadges: [{ label: 'warning', tone: 'warning' }],
                    progressPrefix: '处理进度',
                    progressText: '',
                    historyItems: [],
                    autoResponseSummary: '',
                    responseSummary: '',
                    metaText: '支付单：PAY-1 · FMT:2026-04-01T09:00:00.000Z',
                    hasActions: false,
                    caseActions: [],
                    quickAction: null,
                    workspaceAction: null
                }
            }
        ],
        actions: [
            {
                kind: 'checklist',
                actionName: 'settings-copy-ops-alert-monitor-category',
                icon: 'fas fa-list-check',
                label: '复制清单',
                attrs: {
                    'data-ops-alert-monitor-category-key': 'payments'
                }
            },
            {
                kind: 'workspace',
                actionName: 'settings-open-ops-alert-workspace',
                icon: 'fas fa-credit-card',
                label: '查看订单',
                attrs: {
                    'data-workspace-target': 'payments-orders'
                }
            }
        ]
    });

    const panelState = runtime.buildAdminWorkbenchOpsAlertMonitorPanelState({
        status: 'ready',
        summary: {
            lookback_hours: 72
        }
    }, filters, categories, {
        formatCount: (value) => `#${value}`,
        getFilterSummaryLabel: () => '全部状态 · 仅 warning · 支付与退款'
    });

    assert.deepEqual(JSON.parse(JSON.stringify(panelState)), {
        status: 'ready',
        filteredActiveCount: 3,
        filteredCriticalCount: 1,
        filteredSummaryLabel: '全部状态 · 仅 warning · 支付与退款',
        metaIcon: 'fas fa-siren-on',
        metaText: '当前筛选：全部状态 · 仅 warning · 支付与退款。命中 #3 项待关注告警，覆盖 #1 个模块，其中 #1 项为 critical。',
        emptyMessage: ''
    });

    const batchMuteState = runtime.buildAdminWorkbenchOpsAlertBatchMuteModalState({
        open: true,
        moduleKeys: ['payments', 'tickets'],
        filters: {
            scope: 'active',
            severity: 'critical',
            category: 'all'
        },
        allowCritical: true,
        submitting: false
    }, {
        getModuleLabel: (key) => ({ payments: '支付与退款', tickets: '工单与售后' }[key] || key),
        getFilterSummaryLabel: () => '仅待处理 · 仅 critical · 全部模块',
        formatCount: (value) => `#${value}`,
        getDefaultUntilValue: () => '2026-04-01T12:00'
    });

    assert.deepEqual(JSON.parse(JSON.stringify(batchMuteState)), {
        summaryText: '当前筛选：仅待处理 · 仅 critical · 全部模块 · 命中 #2 个模块（支付与退款、工单与售后）',
        noteText: '当前筛选里的级别条件只用于确定命中模块；本次静默会作用到对应模块的全部告警。',
        allowCriticalActive: true,
        submitDisabled: false,
        submitLabel: '保存静默',
        shouldSeedUntilValue: true,
        defaultUntilValue: '2026-04-01T12:00',
        shouldFocusAfterOpen: true
    });
});

test('shared admin workbench builds ops alert monitor item display and batch action states', () => {
    const runtime = loadAdminWorkbenchRuntime();
    const itemState = runtime.buildAdminWorkbenchOpsAlertMonitorItemDisplayState({
        severity: 'critical',
        risk_level: 'high',
        risk_score: 82,
        title: '优惠券被批量撞库',
        message: '近 10 分钟出现异常高频尝试',
        case_status: 'claimed',
        reference_label: '优惠券',
        reference_value: 'SPRING-2026',
        created_at: '2026-04-01T09:00:00.000Z',
        auto_response_summary: '已自动停券',
        response_summary: '建议继续复核关联订单'
    }, {
        key: 'shop_risk'
    }, {
        formatCount: (value) => `#${value}`,
        formatDateTime: (value) => `FMT:${value}`,
        getSeverityTone: (value) => value === 'critical' ? 'danger' : 'warning',
        getRiskTone: (value) => value === 'high' ? 'warning' : 'neutral',
        getRiskLevelLabel: () => '高',
        getItemAction: () => ({ label: '查看订单', icon: 'fas fa-store', target: 'shop-orders' }),
        getQuickAction: () => ({ action: 'disable-coupon', label: '一键停用优惠码', icon: 'fas fa-ban' }),
        getCaseActions: () => [{ action: 'assign', label: '转交负责人', icon: 'fas fa-user-check' }],
        getCaseStatusLabel: () => '处理中',
        getCaseStatusTone: () => 'neutral',
        getCaseSummaryText: () => '负责人 陈值班',
        getRecentEvents: () => [{ action: 'assign' }],
        getRecentEventText: () => '指派 · 负责人 陈值班'
    });

    assert.deepEqual(JSON.parse(JSON.stringify(itemState)), {
        title: '优惠券被批量撞库',
        message: '近 10 分钟出现异常高频尝试',
        topBadges: [
            { label: 'critical', tone: 'danger' },
            { label: '风险 高 · #82', tone: 'warning' },
            { label: '处置 处理中', tone: 'neutral' }
        ],
        progressPrefix: '值班处理',
        progressText: '负责人 陈值班',
        historyItems: ['指派 · 负责人 陈值班'],
        autoResponseSummary: '已自动停券',
        responseSummary: '建议继续复核关联订单',
        metaText: '优惠券：SPRING-2026 · FMT:2026-04-01T09:00:00.000Z',
        hasActions: true,
        caseActions: [{ action: 'assign', label: '转交负责人', icon: 'fas fa-user-check' }],
        quickAction: { action: 'disable-coupon', label: '一键停用优惠码', icon: 'fas fa-ban' },
        workspaceAction: { label: '查看订单', icon: 'fas fa-store', target: 'shop-orders' }
    });

    const batchActionStates = runtime.buildAdminWorkbenchOpsAlertMonitorBatchActionStates([{ key: 'payments' }], { scope: 'all' }, {
        buildBatchItems: (_categories, action) => {
            if (action === 'assign') return [{ id: 1 }, { id: 2 }];
            if (action === 'add_note') return [];
            if (action === 'resolve') return [{ id: 3 }];
            return [];
        },
        getBatchMuteModuleKeys: () => ['payments', 'tickets'],
        formatCount: (value) => `#${value}`
    });

    assert.deepEqual(JSON.parse(JSON.stringify(batchActionStates)), [
        {
            actionName: 'settings-batch-claim-ops-alert-monitor',
            count: 2,
            disabled: false,
            title: '当前筛选将指派 #2 条告警'
        },
        {
            actionName: 'settings-batch-note-ops-alert-monitor',
            count: 0,
            disabled: true,
            title: '当前筛选条件下没有可备注的告警'
        },
        {
            actionName: 'settings-batch-resolve-ops-alert-monitor',
            count: 1,
            disabled: false,
            title: '当前筛选将关闭 #1 条告警'
        },
        {
            actionName: 'settings-batch-mute-ops-alert-monitor',
            count: 2,
            disabled: false,
            title: '当前筛选将静默 #2 个告警模块'
        }
    ]);
});

test('shared admin workbench derives ops alert monitor action protocol helpers', () => {
    const runtime = loadAdminWorkbenchRuntime();

    assert.deepEqual(JSON.parse(JSON.stringify(runtime.getAdminWorkbenchOpsAlertMonitorCategoryActions('shop_risk'))), [
        { target: 'shop-risk-orders', label: '风险订单', icon: 'fas fa-bag-shopping' },
        { target: 'shop-risk-discounts', label: '优惠券码', icon: 'fas fa-ticket' },
        { target: 'shop-risk-users', label: '用户详情', icon: 'fas fa-user-shield' }
    ]);
    assert.deepEqual(JSON.parse(JSON.stringify(runtime.getAdminWorkbenchOpsAlertMonitorCategoryActions('verify'))), [
        { target: 'verify-monitor', label: '验证运维', icon: 'fas fa-wave-square' }
    ]);
    assert.deepEqual(JSON.parse(JSON.stringify(runtime.getAdminWorkbenchOpsAlertMonitorCategoryActions('security'))), [
        { target: 'admin-audit-monitor', label: '访问审计', icon: 'fas fa-user-shield' }
    ]);

    assert.deepEqual(JSON.parse(JSON.stringify(runtime.normalizeAdminWorkbenchOpsAlertMonitorAssignableAdmins({
        assignable_admins: [{
            id: 'admin_1',
            display_name: '陈值班',
            email: 'chen@example.com',
            role_name: 'Lead',
            is_current: true
        }]
    }))), [{
        id: 'admin_1',
        label: '陈值班',
        email: 'chen@example.com',
        roleName: 'lead',
        isCurrent: true
    }]);

    assert.deepEqual(JSON.parse(JSON.stringify(runtime.normalizeAdminWorkbenchOpsAlertMonitorAssignableAdmins({
        current_admin_id: 'admin_2',
        current_admin_label: '王值班'
    }))), [{
        id: 'admin_2',
        label: '王值班',
        email: '',
        roleName: 'admin',
        isCurrent: true
    }]);

    assert.deepEqual(JSON.parse(JSON.stringify(runtime.buildAdminWorkbenchOpsAlertMonitorActionContext({
        key: 'shop_risk'
    }, {
        title: '优惠券被批量撞库',
        alert_type: 'SHOP_ORDER_RISK_ANOMALY',
        reference_label: '优惠券',
        reference_value: 'SPRING-2026',
        target_id: 'shop_order_risk:coupon:SPRING-2026',
        user_id: 'user_1',
        client_ip: '1.2.3.4',
        discount_code: 'SPRING-2026',
        signal_type: 'coupon',
        session_id: 'session_1',
        case_status: 'CLAIMED',
        case_owner_admin_id: 'admin_1',
        case_owner_label: '陈值班'
    }))), {
        title: '优惠券被批量撞库',
        alertType: 'shop_order_risk_anomaly',
        category: 'shop_risk',
        tab: '',
        email: '',
        signalSourceId: '',
        signalSourceName: '',
        variantName: '',
        placement: '',
        targetMetric: '',
        site: '',
        sessionId: 'session_1',
        referenceLabel: '优惠券',
        referenceValue: 'SPRING-2026',
        targetId: 'shop_order_risk:coupon:SPRING-2026',
        orderId: '',
        ticketId: '',
        ticketStatus: '',
        userId: 'user_1',
        paymentOrderId: '',
        clientIp: '1.2.3.4',
        discountCode: 'SPRING-2026',
        signalType: 'coupon',
        caseStatus: 'claimed',
        caseOwnerAdminId: 'admin_1',
        caseOwnerLabel: '陈值班'
    });

    assert.deepEqual(JSON.parse(JSON.stringify(runtime.getAdminWorkbenchOpsAlertMonitorWorkspaceAction({
        key: 'payments'
    }, {
        alert_type: 'payment_refund_ops',
        target_id: 'refund:1'
    }, {
        getWorkspaceAction: (context, opts) => ({ context, opts }),
        labelVariant: 'monitor'
    }))), {
        context: {
            categoryKey: 'payments',
            alertType: 'payment_refund_ops',
            targetId: 'refund:1'
        },
        opts: {
            labelVariant: 'monitor'
        }
    });

    assert.deepEqual(JSON.parse(JSON.stringify(runtime.getAdminWorkbenchOpsAlertMonitorQuickAction({
        key: 'shop_risk'
    }, {
        alert_type: 'shop_order_risk_anomaly',
        primary_action: 'disable-coupon',
        discount_code: 'SPRING-2026',
        auto_response_status: 'pending'
    }))), {
        action: 'disable-coupon',
        label: '一键停用优惠码',
        icon: 'fas fa-ban'
    });

    assert.deepEqual(JSON.parse(JSON.stringify(runtime.getAdminWorkbenchOpsAlertMonitorCaseActions({
        key: 'shop_risk'
    }, {
        target_id: 'shop_order_risk:coupon:SPRING-2026',
        case_status: 'claimed'
    }))), [
        { action: 'assign', label: '转交负责人', icon: 'fas fa-user-check' },
        { action: 'add_note', label: '备注', icon: 'fas fa-note-sticky' },
        { action: 'resolve', label: '关闭', icon: 'fas fa-circle-check' }
    ]);
});

test('shared admin workbench builds ops alert monitor shift report summary text and csv rows', () => {
    const runtime = loadAdminWorkbenchRuntime();
    const report = {
        shift_hours: 12,
        bucket_hours: 2,
        window_start: '2026-04-01T00:00:00.000Z',
        window_end: '2026-04-01T12:00:00.000Z',
        totals: {
            claimed_count: 6,
            assigned_count: 2,
            resolved_count: 4,
            note_count: 1,
            active_backlog_count: 5,
            active_claimed_count: 3,
            active_pending_count: 2,
            backlog_delta: -1,
            avg_resolution_minutes: 24,
            longest_waiting_minutes: 90
        },
        admin_stats: [
            {
                admin_id: 'admin_1',
                label: '陈值班',
                is_current: true,
                claimed_count: 6,
                assigned_count: 2,
                resolved_count: 4,
                active_count: 4,
                critical_active_count: 1,
                avg_resolution_minutes: 24
            }
        ],
        categories: [
            {
                key: 'payments',
                label: '支付与退款',
                backlog_count: 4,
                pending_count: 1,
                claimed_count: 3,
                critical_count: 1
            }
        ],
        close_reasons: [
            { label: '人工复核完成', count: 4 }
        ],
        trend: [
            {
                bucket_end: '2026-04-01T10:00:00.000Z',
                backlog_count: 5,
                claimed_count: 2,
                assigned_count: 1,
                resolved_count: 2
            }
        ]
    };
    const viewDefinitions = [
        { key: 'all', label: '全部视角', sections: ['categories', 'admins', 'close_reasons', 'trend'] },
        { key: 'mine', label: '我的接班', sections: ['categories', 'admins'] }
    ];

    const summary = runtime.buildAdminWorkbenchOpsAlertMonitorShiftReportSummaryText(report, {
        currentView: 'mine',
        currentAdminId: 'admin_1',
        currentAdminLabel: '陈值班',
        ownedCategoryItems: [
            {
                key: 'payments',
                label: '支付与退款',
                backlog_count: 4,
                pending_count: 1,
                claimed_count: 3,
                critical_count: 1
            }
        ],
        generatedAt: '2026-04-01T12:00:00.000Z'
    }, {
        viewDefinitions,
        defaultView: 'all',
        formatDateTime: (value) => `FMT:${value}`,
        formatCount: (value) => `#${value}`,
        formatMinutes: (value) => `${value}分钟`,
        formatSignedCount: (value) => (value > 0 ? `+${value}` : String(value)),
        formatTimeShort: (value) => `T:${value}`
    });

    assert.match(summary, /交班视角：我的接班/);
    assert.match(summary, /当前值班：陈值班/);
    assert.match(summary, /你本班认领 #6，接手 #2，关闭 #4。/);
    assert.match(summary, /1\. 支付与退款：积压 #4，待认领 #1，处理中 #3，critical #1/);

    const rows = runtime.buildAdminWorkbenchOpsAlertMonitorShiftReportCsvRows(report, {
        currentView: 'mine',
        currentAdminId: 'admin_1',
        currentAdminLabel: '陈值班',
        ownedCategoryItems: [
            {
                key: 'payments',
                label: '支付与退款',
                backlog_count: 4,
                pending_count: 1,
                claimed_count: 3,
                critical_count: 1
            }
        ]
    }, {
        viewDefinitions,
        defaultView: 'all',
        formatTimeShort: (value) => `T:${value}`
    });

    assert.deepEqual(JSON.parse(JSON.stringify(rows)), [
        {
            section: 'summary',
            item: '班次概览',
            current_admin: '陈值班',
            view_mode: 'mine',
            view_label: '我的接班',
            shift_hours: 12,
            bucket_hours: 2,
            window_start: '2026-04-01T00:00:00.000Z',
            window_end: '2026-04-01T12:00:00.000Z',
            claimed_count: 6,
            assigned_count: 2,
            resolved_count: 4,
            note_count: 1,
            reopened_count: 0,
            avg_resolution_minutes: 24,
            active_backlog_count: 5,
            active_claimed_count: 3,
            active_pending_count: 2,
            previous_backlog_count: 0,
            backlog_delta: -1,
            longest_waiting_minutes: 90,
            current_admin_active_count: 4,
            current_admin_critical_active_count: 1,
            current_admin_claimed_count: 6,
            current_admin_assigned_count: 2,
            current_admin_resolved_count: 4,
            current_admin_avg_resolution_minutes: 24
        },
        {
            section: 'categories',
            item: '支付与退款',
            category_key: 'payments',
            backlog_count: 4,
            pending_count: 1,
            claimed_count: 3,
            critical_count: 1
        },
        {
            section: 'admins',
            item: '陈值班',
            admin_id: 'admin_1',
            is_current: true,
            claimed_count: 6,
            assigned_count: 2,
            resolved_count: 4,
            active_count: 4,
            critical_active_count: 1,
            avg_resolution_minutes: 24
        }
    ]);
});

test('shared admin workbench builds ops alert monitor shift trend state', () => {
    const runtime = loadAdminWorkbenchRuntime();
    const trendState = runtime.buildAdminWorkbenchOpsAlertMonitorShiftTrendState({
        bucket_hours: 2,
        trend: [
            {
                bucket_end: '2026-04-01T10:00:00.000Z',
                backlog_count: 5,
                claimed_count: 2,
                assigned_count: 1,
                resolved_count: 2
            },
            {
                bucket_end: '2026-04-01T12:00:00.000Z',
                backlog_count: 0,
                claimed_count: 0,
                assigned_count: 0,
                resolved_count: 0
            }
        ]
    }, {
        formatCount: (value) => `#${value}`,
        formatTimeShort: (value) => `T:${value}`
    });

    assert.deepEqual(JSON.parse(JSON.stringify(trendState)), {
        bucketHours: 2,
        footerText: '按 #2 小时时间桶回看本班积压走势。',
        emptyMessage: '本班还没有形成可展示的积压变化。',
        items: [
            {
                backlogText: '#5',
                heightPercent: 100,
                labelText: 'T:2026-04-01T10:00:00.000Z',
                metaText: '认领 #2 · 转交 #1 · 关闭 #2'
            },
            {
                backlogText: '#0',
                heightPercent: 16,
                labelText: 'T:2026-04-01T12:00:00.000Z',
                metaText: '无动作'
            }
        ]
    });
});

test('shared admin workbench builds ops alert monitor shift view switch and report state', () => {
    const runtime = loadAdminWorkbenchRuntime();
    const viewDefinitions = [
        { key: 'all', label: '全部视角', description: '查看全量交班信息', sections: ['categories', 'admins', 'close_reasons', 'trend'] },
        { key: 'mine', label: '我的接班', description: '只看我名下的处理中告警', sections: ['categories', 'admins'] }
    ];
    const report = {
        shift_hours: 12,
        totals: {
            claimed_count: 6,
            assigned_count: 2,
            resolved_count: 4,
            note_count: 1,
            active_backlog_count: 5,
            active_claimed_count: 3,
            active_pending_count: 2,
            backlog_delta: -1,
            avg_resolution_minutes: 24,
            longest_waiting_minutes: 90
        },
        admin_stats: [
            {
                admin_id: 'admin_1',
                label: '陈值班',
                is_current: true,
                claimed_count: 6,
                assigned_count: 2,
                resolved_count: 4,
                active_count: 4,
                critical_active_count: 1,
                avg_resolution_minutes: 24
            }
        ],
        close_reasons: [{ label: '人工复核完成', count: 4 }]
    };

    const viewSwitchState = runtime.buildAdminWorkbenchOpsAlertMonitorShiftViewSwitchState('mine', {
        viewDefinitions,
        defaultView: 'all'
    });

    assert.deepEqual(JSON.parse(JSON.stringify(viewSwitchState)), {
        label: '交班视角',
        currentView: 'mine',
        summaryText: '只看我名下的处理中告警',
        chips: [
            { key: 'all', label: '全部视角', active: false },
            { key: 'mine', label: '我的接班', active: true }
        ]
    });

    const reportState = runtime.buildAdminWorkbenchOpsAlertMonitorShiftReportState(report, {
        currentView: 'mine',
        currentAdminId: 'admin_1',
        currentAdminLabel: '陈值班',
        ownedCategoryItems: [
            {
                key: 'payments',
                label: '支付与退款',
                backlog_count: 4,
                pending_count: 1,
                claimed_count: 3,
                critical_count: 1
            }
        ]
    }, {
        viewDefinitions,
        defaultView: 'all',
        formatCount: (value) => `#${value}`,
        formatMinutes: (value) => `${value}分钟`,
        formatSignedCount: (value) => (value > 0 ? `+${value}` : String(value)),
        getBacklogDeltaTone: (value) => value < 0 ? 'success' : (value > 0 ? 'warning' : 'neutral')
    });

    assert.deepEqual(JSON.parse(JSON.stringify(reportState)), {
        currentView: 'mine',
        viewMeta: {
            key: 'mine',
            label: '我的接班',
            description: '只看我名下的处理中告警'
        },
        headline: '陈值班 当前名下有 #4 条处理中告警，覆盖 #1 个模块。',
        summary: '本班你认领 #6、接手 #2、关闭 #4 条告警，平均闭环 24分钟；当前名下 #1 条 critical。',
        headerBadges: [
            { label: '班次 #12 小时', tone: 'neutral' },
            { label: '当前值班 陈值班', tone: 'neutral' },
            { label: '我名下 #4', tone: 'warning' },
            { label: '#1 critical', tone: 'danger' }
        ],
        metrics: [
            { label: '我名下处理中', value: '#4', detail: '覆盖 #1 个模块', tone: 'warning' },
            { label: '我名下 critical', value: '#1', detail: '优先处理高优先级积压', tone: 'danger' },
            { label: '本班认领', value: '#6', detail: '本班你主动接手的告警', tone: 'neutral' },
            { label: '转交 / 接手', value: '#2', detail: '本班由你接手的告警', tone: 'warning' },
            { label: '本班关闭', value: '#4', detail: '你本班完成闭环的告警', tone: 'success' },
            { label: '我的平均闭环', value: '24分钟', detail: '基于 #4 条已关闭告警', tone: 'success' }
        ],
        panelTitles: {
            categories: '我名下积压模块',
            admins: '我的处理量',
            trend: '积压趋势',
            closeReasons: '关闭原因分布'
        }
    });

    const panelStates = runtime.buildAdminWorkbenchOpsAlertMonitorShiftPanelStates(report, {
        currentView: 'mine',
        currentAdminId: 'admin_1',
        currentAdminLabel: '陈值班',
        ownedCategoryItems: [
            {
                key: 'payments',
                label: '支付与退款',
                backlog_count: 4,
                pending_count: 1,
                claimed_count: 3,
                critical_count: 1
            }
        ]
    }, {
        viewDefinitions,
        defaultView: 'all',
        formatCount: (value) => `#${value}`,
        formatMinutes: (value) => `${value}分钟`,
        formatSignedCount: (value) => (value > 0 ? `+${value}` : String(value)),
        getBacklogDeltaTone: (value) => value < 0 ? 'success' : (value > 0 ? 'warning' : 'neutral')
    });

    assert.deepEqual(JSON.parse(JSON.stringify(panelStates)), {
        currentView: 'mine',
        visibleSections: ['categories', 'admins'],
        sections: {
            categories: {
                visible: true,
                title: '我名下积压模块',
                emptyMessage: '当前没有分配到你名下的积压模块。',
                items: [
                    {
                        title: '支付与退款',
                        meta: '积压 #4 · 待认领 #1 · 处理中 #3 · critical #1',
                        badges: [
                            { label: '#1 critical', tone: 'danger' },
                            { label: '#4 积压', tone: 'warning' }
                        ]
                    }
                ]
            },
            admins: {
                visible: true,
                title: '我的处理量',
                emptyMessage: '当前还没有归属到你名下的处理动作。',
                items: [
                    {
                        title: '陈值班',
                        meta: '认领 #6 · 接手 #2 · 关闭 #4 · 手上 #4 · 平均 24分钟',
                        badges: [
                            { label: '当前值班', tone: 'neutral' },
                            { label: '#1 critical', tone: 'danger' }
                        ]
                    }
                ]
            },
            trend: {
                visible: false,
                title: '积压趋势',
                wide: true
            },
            closeReasons: {
                visible: false,
                title: '关闭原因分布',
                emptyMessage: '本班还没有可归类的关闭原因。',
                items: [
                    {
                        title: '人工复核完成',
                        meta: '本班关闭 #4 条',
                        badges: [
                            { label: '#4 条', tone: 'success' }
                        ]
                    }
                ]
            }
        }
    });
});

test('shared admin workbench builds ops alert monitor shift shell and aggregate render state', () => {
    const runtime = loadAdminWorkbenchRuntime();
    const viewDefinitions = [
        { key: 'all', label: '全部视角', description: '查看全量交班信息', sections: ['categories', 'admins', 'close_reasons', 'trend'] },
        { key: 'mine', label: '我的接班', description: '只看我名下的处理中告警', sections: ['categories', 'admins'] }
    ];
    const loadingShell = runtime.buildAdminWorkbenchOpsAlertMonitorShiftShellState('loading');
    assert.equal(loadingShell.title, '正在汇总认领、转交、关闭和积压趋势...');
    assert.equal(loadingShell.badges[0].label, '等待加载');
    assert.equal(loadingShell.metrics.length, 6);

    const errorShell = runtime.buildAdminWorkbenchOpsAlertMonitorShiftShellState('error', {
        message: '交班报表暂时不可用'
    });
    assert.equal(errorShell.summary, '交班报表暂时不可用');
    assert.equal(errorShell.badges[0].tone, 'danger');

    const renderState = runtime.buildAdminWorkbenchOpsAlertMonitorShiftRenderState({
        shift_hours: 12,
        bucket_hours: 2,
        totals: {
            claimed_count: 6,
            assigned_count: 2,
            resolved_count: 4,
            note_count: 1,
            active_backlog_count: 5,
            active_claimed_count: 3,
            active_pending_count: 2,
            backlog_delta: -1,
            avg_resolution_minutes: 24,
            longest_waiting_minutes: 90
        },
        admin_stats: [
            {
                admin_id: 'admin_1',
                label: '陈值班',
                is_current: true,
                claimed_count: 6,
                assigned_count: 2,
                resolved_count: 4,
                active_count: 4,
                critical_active_count: 1,
                avg_resolution_minutes: 24
            }
        ],
        trend: [
            {
                bucket_end: '2026-04-01T10:00:00.000Z',
                backlog_count: 5,
                claimed_count: 2,
                assigned_count: 1,
                resolved_count: 2
            }
        ]
    }, {
        currentView: 'mine',
        currentAdminId: 'admin_1',
        currentAdminLabel: '陈值班',
        ownedCategoryItems: [
            {
                key: 'payments',
                label: '支付与退款',
                backlog_count: 4,
                pending_count: 1,
                claimed_count: 3,
                critical_count: 1
            }
        ]
    }, {
        viewDefinitions,
        defaultView: 'all',
        formatCount: (value) => `#${value}`,
        formatMinutes: (value) => `${value}分钟`,
        formatSignedCount: (value) => (value > 0 ? `+${value}` : String(value)),
        formatTimeShort: (value) => `T:${value}`,
        getBacklogDeltaTone: (value) => value < 0 ? 'success' : (value > 0 ? 'warning' : 'neutral')
    });

    assert.equal(renderState.currentView, 'mine');
    assert.equal(renderState.viewSwitchState.currentView, 'mine');
    assert.equal(renderState.actionButtons.length, 2);
    assert.equal(renderState.actionButtons[0].actionName, 'settings-copy-ops-alert-shift-report');
    assert.equal(renderState.reportState.headline, '陈值班 当前名下有 #4 条处理中告警，覆盖 #1 个模块。');
    assert.equal(renderState.panelStates.sections.categories.items[0].title, '支付与退款');
    assert.equal(renderState.trendState.items[0].labelText, 'T:2026-04-01T10:00:00.000Z');
});

test('shared admin workbench fetches ops alert monitor payloads with timeout-aware request settings', async () => {
    const runtime = loadAdminWorkbenchRuntime();
    const calls = [];
    let clearedTimeoutId = 0;
    class FakeAbortController {
        constructor() {
            this.signal = { aborted: false };
        }
        abort() {
            this.signal.aborted = true;
        }
    }

    const payload = await runtime.fetchAdminWorkbenchOpsAlertMonitor(
        { authorization: 'Bearer test' },
        {
            endpoint: '/custom/ops-alert-monitor',
            timeoutMs: 1234,
            AbortController: FakeAbortController,
            setTimeout(handler, delay) {
                calls.push({ type: 'setTimeout', delay, hasHandler: typeof handler === 'function' });
                return 42;
            },
            clearTimeout(timeoutId) {
                clearedTimeoutId = timeoutId;
            },
            fetch: async (url, init) => {
                calls.push({ type: 'fetch', url, init });
                return {
                    ok: true,
                    async json() {
                        return { success: true, fetched_at: '2026-04-01T12:00:00.000Z' };
                    }
                };
            }
        }
    );

    assert.deepEqual(JSON.parse(JSON.stringify(payload)), {
        success: true,
        fetched_at: '2026-04-01T12:00:00.000Z'
    });
    assert.equal(calls[0].type, 'setTimeout');
    assert.equal(calls[0].delay, 1234);
    assert.equal(calls[1].type, 'fetch');
    assert.equal(calls[1].url, '/custom/ops-alert-monitor');
    assert.equal(calls[1].init.method, 'GET');
    assert.equal(calls[1].init.headers.authorization, 'Bearer test');
    assert.ok(calls[1].init.signal);
    assert.equal(clearedTimeoutId, 42);
});

test('shared admin workbench normalizes ops alert monitor payloads into state-friendly snapshots', () => {
    const runtime = loadAdminWorkbenchRuntime();
    const normalized = runtime.normalizeAdminWorkbenchOpsAlertMonitorPayload({
        fetched_at: '2026-04-01T12:00:00.000Z',
        summary: {
            lookback_hours: 24,
            shift_report: {
                shift_hours: 8
            }
        },
        assignable_admins: [{ id: 'admin_1' }],
        current_admin_id: 'admin_1',
        current_admin_label: '陈值班',
        categories: [{ key: 'payments' }]
    }, {
        defaultSummary: {
            lookback_hours: 168,
            total_active_count: 0
        },
        normalizeShiftReport: (report) => ({
            normalized: true,
            shift_hours: Number(report?.shift_hours || 0)
        })
    });

    assert.deepEqual(JSON.parse(JSON.stringify(normalized)), {
        fetched_at: '2026-04-01T12:00:00.000Z',
        summary: {
            lookback_hours: 24,
            total_active_count: 0,
            shift_report: {
                normalized: true,
                shift_hours: 8
            }
        },
        assignable_admins: [{ id: 'admin_1' }],
        current_admin_id: 'admin_1',
        current_admin_label: '陈值班',
        categories: [{ key: 'payments' }],
        message: ''
    });
});

test('shared admin workbench fetches ops alert health payloads with timeout-aware request settings', async () => {
    const runtime = loadAdminWorkbenchRuntime();
    const calls = [];
    let clearedTimeoutId = 0;
    class FakeAbortController {
        constructor() {
            this.signal = { aborted: false };
        }
        abort() {
            this.signal.aborted = true;
        }
    }

    const payload = await runtime.fetchAdminWorkbenchOpsAlertHealth(
        { authorization: 'Bearer test' },
        {
            endpoint: '/custom/ops-alert-health',
            timeoutMs: 2345,
            AbortController: FakeAbortController,
            setTimeout(handler, delay) {
                calls.push({ type: 'setTimeout', delay, hasHandler: typeof handler === 'function' });
                return 84;
            },
            clearTimeout(timeoutId) {
                clearedTimeoutId = timeoutId;
            },
            fetch: async (url, init) => {
                calls.push({ type: 'fetch', url, init });
                return {
                    ok: true,
                    async json() {
                        return { success: true, fetched_at: '2026-04-01T13:00:00.000Z' };
                    }
                };
            }
        }
    );

    assert.deepEqual(JSON.parse(JSON.stringify(payload)), {
        success: true,
        fetched_at: '2026-04-01T13:00:00.000Z'
    });
    assert.equal(calls[0].type, 'setTimeout');
    assert.equal(calls[0].delay, 2345);
    assert.equal(calls[1].type, 'fetch');
    assert.equal(calls[1].url, '/custom/ops-alert-health');
    assert.equal(calls[1].init.method, 'GET');
    assert.equal(calls[1].init.headers.authorization, 'Bearer test');
    assert.ok(calls[1].init.signal);
    assert.equal(clearedTimeoutId, 84);
});

test('shared admin workbench normalizes ops alert health payloads into state-friendly snapshots', () => {
    const runtime = loadAdminWorkbenchRuntime();
    const normalized = runtime.normalizeAdminWorkbenchOpsAlertHealthPayload({
        fetched_at: '2026-04-01T13:00:00.000Z',
        summary: {
            lookback_hours: 24,
            total_job_count: 12
        },
        channels: [{ key: 'telegram' }]
    }, {
        defaultSummary: {
            lookback_hours: 72,
            total_job_count: 0,
            dead_letter_count: 0
        }
    });

    assert.deepEqual(JSON.parse(JSON.stringify(normalized)), {
        fetched_at: '2026-04-01T13:00:00.000Z',
        summary: {
            lookback_hours: 24,
            total_job_count: 12,
            dead_letter_count: 0
        },
        channels: [{ key: 'telegram' }],
        message: ''
    });
});

test('shared admin workbench fetches ops alert settings payloads', async () => {
    const runtime = loadAdminWorkbenchRuntime();
    const calls = [];
    const payload = await runtime.fetchAdminWorkbenchOpsAlertSettings(
        { authorization: 'Bearer test' },
        {
            endpoint: '/custom/ops-alerts',
            fetch: async (url, init) => {
                calls.push({ url, init });
                return {
                    ok: true,
                    async json() {
                        return {
                            success: true,
                            config: { enabled: true },
                            secrets: { telegram_bot_token: { configured: true } }
                        };
                    }
                };
            }
        }
    );

    assert.deepEqual(JSON.parse(JSON.stringify(payload)), {
        success: true,
        config: { enabled: true },
        secrets: { telegram_bot_token: { configured: true } }
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/custom/ops-alerts');
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.headers.authorization, 'Bearer test');
});

test('shared admin workbench submits ops alert settings payloads', async () => {
    const runtime = loadAdminWorkbenchRuntime();
    const calls = [];
    const payload = await runtime.submitAdminWorkbenchOpsAlertSettings(
        { authorization: 'Bearer test' },
        {
            action: 'save',
            config: { enabled: true }
        },
        {
            endpoint: '/custom/ops-alerts',
            fetch: async (url, init) => {
                calls.push({ url, init });
                return {
                    ok: true,
                    async json() {
                        return {
                            success: true,
                            message: 'saved'
                        };
                    }
                };
            }
        }
    );

    assert.deepEqual(JSON.parse(JSON.stringify(payload)), {
        success: true,
        message: 'saved'
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/custom/ops-alerts');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers.authorization, 'Bearer test');
    assert.deepEqual(JSON.parse(calls[0].init.body), {
        action: 'save',
        config: { enabled: true }
    });
});

test('shared admin workbench deletes ops alert secrets through the shared endpoint', async () => {
    const runtime = loadAdminWorkbenchRuntime();
    const calls = [];
    const payload = await runtime.deleteAdminWorkbenchOpsAlertSecret(
        { authorization: 'Bearer test' },
        'telegram_bot_token',
        {
            endpoint: '/custom/ops-alerts',
            fetch: async (url, init) => {
                calls.push({ url, init });
                return {
                    ok: true,
                    async json() {
                        return {
                            success: true,
                            message: 'deleted'
                        };
                    }
                };
            }
        }
    );

    assert.deepEqual(JSON.parse(JSON.stringify(payload)), {
        success: true,
        message: 'deleted'
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/custom/ops-alerts');
    assert.equal(calls[0].init.method, 'DELETE');
    assert.equal(calls[0].init.headers.authorization, 'Bearer test');
    assert.deepEqual(JSON.parse(calls[0].init.body), {
        secretName: 'telegram_bot_token'
    });
});

test('shared admin workbench reads, clears, and builds ops alert settings request bodies from secret inputs', () => {
    const runtime = loadAdminWorkbenchRuntime();
    const inputs = new Map([
        ['opsAlertTelegramBotToken', { value: ' tg-token ' }],
        ['opsAlertFeishuWebhookUrl', { value: ' https://hooks.feishu.test ' }],
        ['opsAlertEmailApiKey', { value: ' email-key ' }]
    ]);
    const documentRef = {
        getElementById(id) {
            return inputs.get(id) || null;
        }
    };

    const secrets = runtime.readAdminWorkbenchOpsAlertSecretInputs({ document: documentRef });
    assert.deepEqual(JSON.parse(JSON.stringify(secrets)), {
        telegram_bot_token: 'tg-token',
        feishu_webhook_url: 'https://hooks.feishu.test',
        email_api_key: 'email-key'
    });

    const requestBody = runtime.buildAdminWorkbenchOpsAlertSettingsRequestBody({ enabled: true }, {
        document: documentRef,
        action: 'send_test_telegram',
        caseEvents: [{ action: 'batch_mute' }]
    });
    assert.deepEqual(JSON.parse(JSON.stringify(requestBody)), {
        config: { enabled: true },
        secrets: {
            telegram_bot_token: 'tg-token',
            feishu_webhook_url: 'https://hooks.feishu.test',
            email_api_key: 'email-key'
        },
        action: 'send_test_telegram',
        case_events: [{ action: 'batch_mute' }]
    });

    runtime.clearAdminWorkbenchOpsAlertSecretInputs({ document: documentRef });
    assert.equal(inputs.get('opsAlertTelegramBotToken').value, '');
    assert.equal(inputs.get('opsAlertFeishuWebhookUrl').value, '');
    assert.equal(inputs.get('opsAlertEmailApiKey').value, '');
});

test('shared admin workbench validates ops alert dispatch channel prerequisites', () => {
    const runtime = loadAdminWorkbenchRuntime();

    const validatedSecrets = runtime.validateAdminWorkbenchOpsAlertDispatchConfig({
        channels: {
            telegram: {
                enabled: true,
                chat_ids: ['123']
            },
            feishu: {
                enabled: true
            },
            email: {
                enabled: true,
                recipients: ['ops@example.com'],
                from_address: 'sender@example.com'
            }
        }
    }, {
        telegram_bot_token: { configured: false },
        feishu_webhook_url: { configured: true },
        email_api_key: { configured: false }
    }, {
        telegram_bot_token: 'tg-token',
        feishu_webhook_url: '',
        email_api_key: 'email-key'
    });

    assert.deepEqual(JSON.parse(JSON.stringify(validatedSecrets)), {
        telegram_bot_token: 'tg-token',
        feishu_webhook_url: '',
        email_api_key: 'email-key'
    });

    assert.throws(() => {
        runtime.validateAdminWorkbenchOpsAlertDispatchConfig({
            channels: {
                telegram: {
                    enabled: true,
                    chat_ids: []
                }
            }
        }, {}, {
            telegram_bot_token: ''
        });
    }, /Telegram Chat ID/);
});

test('shared admin workbench collects ops alert strategy drafts from settings controls', () => {
    const runtime = loadAdminWorkbenchRuntime();
    const createToggle = (active) => ({
        classList: {
            contains(className) {
                return className === 'active' ? active : false;
            }
        }
    });
    const createInput = (value) => ({ value });
    const createCheckbox = (checked) => ({ checked });
    const elements = new Map([
        ['opsAlertEnabledToggle', createToggle(true)],
        ['opsAlertTemporaryMuteUntil', createInput('2026-04-01T16:00')],
        ['opsAlertTemporaryMuteAllowCriticalToggle', createToggle(false)],
        ['opsAlertQuietHoursEnabledToggle', createToggle(true)],
        ['opsAlertQuietHoursStartHour', createInput('22')],
        ['opsAlertQuietHoursEndHour', createInput('8')],
        ['opsAlertQuietHoursTimezone', createInput('Asia/Shanghai')],
        ['opsAlertQuietHoursAllowCriticalToggle', createToggle(true)],
        ['opsAlertWorkHoursEnabledToggle', createToggle(true)],
        ['opsAlertWorkHoursStartHour', createInput('9')],
        ['opsAlertWorkHoursEndHour', createInput('18')],
        ['opsAlertWorkHoursTimezone', createInput('Asia/Singapore')],
        ['opsAlertMuteRuleTypesTicketsUntil', createInput('2026-04-01T18:00')],
        ['opsAlertMuteRuleTypesTicketsAllowCriticalToggle', createToggle(false)],
        ['opsAlertMuteRuleModulesPaymentsUntil', createInput('2026-04-01T19:00')],
        ['opsAlertMuteRuleModulesPaymentsAllowCriticalToggle', createToggle(true)],
        ['opsAlertTelegramEnabledToggle', createToggle(true)],
        ['opsAlertTelegramChatIds', createInput('10001\n10002')],
        ['opsAlertTelegramSeverity', createInput('critical')],
        ['opsAlertFeishuEnabledToggle', createToggle(false)],
        ['opsAlertFeishuSeverity', createInput('warning')],
        ['opsAlertEmailEnabledToggle', createToggle(true)],
        ['opsAlertEmailSeverity', createInput('danger')],
        ['opsAlertEmailRecipients', createInput('ops@example.com\nlead@example.com')],
        ['opsAlertEmailFromAddress', createInput('sender@example.com')],
        ['opsAlertEmailReplyTo', createInput('reply@example.com')],
        ['opsAlertEmailSubjectPrefix', createInput('[OPS]')],
        ['routing-tickets-telegram', createCheckbox(true)],
        ['routing-tickets-feishu', createCheckbox(false)],
        ['routing-tickets-email', createCheckbox(true)]
    ]);
    const documentRef = {
        getElementById(id) {
            return elements.get(id) || null;
        }
    };

    const draft = runtime.collectAdminWorkbenchOpsAlertStrategyDraft({
        enabled: false,
        temporary_mute: {
            until: '',
            allow_critical: true
        },
        quiet_hours: {
            enabled: false,
            start_hour: 0,
            end_hour: 0,
            timezone: 'UTC',
            allow_critical: false
        },
        work_hours: {
            enabled: false,
            start_hour: 8,
            end_hour: 17,
            timezone: 'UTC'
        },
        mute_rules: {
            types: {
                tickets: {
                    until: '',
                    allow_critical: true
                }
            },
            modules: {
                payments: {
                    until: '',
                    allow_critical: false
                }
            }
        },
        channels: {
            telegram: {
                enabled: false,
                chat_ids: [],
                minimum_severity: 'warning'
            },
            feishu: {
                enabled: true,
                minimum_severity: 'critical'
            },
            email: {
                enabled: false,
                minimum_severity: 'warning',
                recipients: [],
                from_address: '',
                reply_to: '',
                subject_prefix: '[Fallback]'
            }
        },
        routing: {
            tickets: {
                telegram: false,
                feishu: true,
                email: false
            }
        }
    }, {
        document: documentRef,
        normalizeDateTimeLocalInputValue: (value) => `normalized:${value}`,
        clamp: (value, min, max) => Math.min(max, Math.max(min, Number(value))),
        toWholeNumber: (value, fallbackValue) => {
            const parsed = Number.parseInt(value, 10);
            return Number.isFinite(parsed) ? parsed : fallbackValue;
        },
        normalizeConfigStringArray: (value) => String(value).split('\n').map((item) => item.trim()).filter(Boolean),
        normalizeOpsAlertSeverity: (value, fallbackValue) => String(value || fallbackValue).trim().toLowerCase(),
        getMuteRuleDefinitions: (scope) => scope === 'types'
            ? [{ key: 'tickets' }]
            : [{ key: 'payments' }],
        getMuteRuleElementId: (scope, key, suffix) => `opsAlertMuteRule${scope.charAt(0).toUpperCase()}${scope.slice(1)}${key.charAt(0).toUpperCase()}${key.slice(1)}${suffix}`,
        getRoutingCheckboxId: (routingKey, channelKey) => `routing-${routingKey}-${channelKey}`
    });

    assert.deepEqual(JSON.parse(JSON.stringify(draft)), {
        enabled: true,
        temporary_mute: {
            until: 'normalized:2026-04-01T16:00',
            allow_critical: false
        },
        quiet_hours: {
            enabled: true,
            start_hour: 22,
            end_hour: 8,
            timezone: 'Asia/Shanghai',
            allow_critical: true
        },
        work_hours: {
            enabled: true,
            start_hour: 9,
            end_hour: 18,
            timezone: 'Asia/Singapore'
        },
        mute_rules: {
            types: {
                tickets: {
                    until: 'normalized:2026-04-01T18:00',
                    allow_critical: false
                }
            },
            modules: {
                payments: {
                    until: 'normalized:2026-04-01T19:00',
                    allow_critical: true
                }
            }
        },
        channels: {
            telegram: {
                enabled: true,
                chat_ids: ['10001', '10002'],
                minimum_severity: 'critical'
            },
            feishu: {
                enabled: false,
                minimum_severity: 'warning'
            },
            email: {
                enabled: true,
                minimum_severity: 'danger',
                recipients: ['ops@example.com', 'lead@example.com'],
                from_address: 'sender@example.com',
                reply_to: 'reply@example.com',
                subject_prefix: '[OPS]'
            }
        },
        routing: {
            tickets: {
                telegram: true,
                feishu: false,
                email: true
            }
        }
    });
});

test('shared admin workbench builds ops alert config draft with cloned nested sections', () => {
    const runtime = loadAdminWorkbenchRuntime();
    const sourceConfig = {
        enabled: true,
        temporary_mute: { until: '2026-04-01T00:00:00.000Z', allow_critical: true },
        quiet_hours: { enabled: true, start_hour: 22, end_hour: 8, timezone: 'UTC', allow_critical: false },
        work_hours: { enabled: false, start_hour: 9, end_hour: 18, timezone: 'Asia/Shanghai' },
        mute_rules: {
            types: {
                customer_chat_message: { until: '2026-04-02T00:00:00.000Z', allow_critical: true }
            },
            modules: {
                payment_gateway: { until: '', allow_critical: false }
            }
        },
        channels: {
            telegram: { enabled: true, chat_ids: ['1'], minimum_severity: 'warning' },
            feishu: { enabled: false, minimum_severity: 'critical' },
            email: { enabled: true, recipients: ['a@example.com'], minimum_severity: 'danger' }
        },
        routing: {
            customer_chat_message: { telegram: true, feishu: false, email: true }
        },
        customer_chat_message: {
            quick_reply_templates: [{ id: 'hello' }]
        },
        tickets: {
            reply_templates: [{ id: 'resolved_generic', action: 'resolved', issue_type: 'all', body: '已处理完成。' }]
        },
        payment_gateway: {
            enabled: true
        }
    };

    const draft = runtime.buildAdminWorkbenchOpsAlertConfigDraft(sourceConfig, {
        normalizeQuickReplyTemplates: (templates = []) => templates.map((item) => ({ ...item, normalized: true })),
        normalizeTicketReplyTemplates: (templates = []) => templates.map((item) => ({ ...item, normalized: true }))
    });

    assert.notEqual(draft, sourceConfig);
    assert.notEqual(draft.work_hours, sourceConfig.work_hours);
    assert.notEqual(draft.routing, sourceConfig.routing);
    assert.notEqual(draft.routing.customer_chat_message, sourceConfig.routing.customer_chat_message);
    assert.notEqual(draft.customer_chat_message, sourceConfig.customer_chat_message);
    assert.notEqual(draft.customer_chat_message.quick_reply_templates, sourceConfig.customer_chat_message.quick_reply_templates);
    assert.notEqual(draft.tickets, sourceConfig.tickets);
    assert.notEqual(draft.tickets.reply_templates, sourceConfig.tickets.reply_templates);
    assert.equal(draft.customer_chat_message.quick_reply_templates[0].normalized, true);
    assert.equal(draft.tickets.reply_templates[0].normalized, true);

    draft.work_hours.enabled = true;
    draft.routing.customer_chat_message.feishu = true;
    draft.customer_chat_message.quick_reply_templates[0].id = 'changed';
    draft.tickets.reply_templates[0].id = 'changed_ticket_template';

    assert.equal(sourceConfig.work_hours.enabled, false);
    assert.equal(sourceConfig.routing.customer_chat_message.feishu, false);
    assert.equal(sourceConfig.customer_chat_message.quick_reply_templates[0].id, 'hello');
    assert.equal(sourceConfig.tickets.reply_templates[0].id, 'resolved_generic');
});

test('shared admin workbench builds ops alert summary mode hint text and unified summary drafts', () => {
    const runtime = loadAdminWorkbenchRuntime();
    const hintText = runtime.buildAdminWorkbenchOpsAlertSummaryModeHintText({
        summary_schedule_mode: 'daily',
        summary_daily_hour: 9,
        summary_daily_minute: 5
    }, {
        normalizeScheduleMode: (value, fallbackValue = 'rolling_window') => String(value || fallbackValue).trim().toLowerCase() || fallbackValue,
        formatCount: (value) => `COUNT:${value}`,
        formatTimeNumber: (value) => String(Number(value || 0)).padStart(2, '0'),
        formatHourMinute: (hour, minute) => `${String(Number(hour || 0)).padStart(2, '0')}:${String(Number(minute || 0)).padStart(2, '0')}`,
        monitorEnabled: true,
        summaryEnabled: true
    });
    assert.equal(hintText, '当前会在每天 09:05 统一发送。');

    const createCheckbox = (checked) => ({ checked });
    const createInput = (value) => ({ value });
    const elements = new Map([
        ['opsAlertUnifiedSummaryDraftEnabled', createCheckbox(true)],
        ['opsAlertUnifiedSummaryDraftWorkHoursOnlyEnabled', createCheckbox(false)],
        ['opsAlertUnifiedSummaryDraftScheduleMode', createInput('hourly')],
        ['opsAlertUnifiedSummaryDraftWindowMinutes', createInput('95')],
        ['opsAlertUnifiedSummaryDraftHourlyMinute', createInput('42')],
        ['opsAlertUnifiedSummaryDraftDailyHour', createInput('11')],
        ['opsAlertUnifiedSummaryDraftDailyMinute', createInput('17')],
        ['opsAlertUnifiedSummaryDraftMaxItems', createInput('18')]
    ]);
    const documentRef = {
        getElementById(id) {
            return elements.get(id) || null;
        }
    };

    const draft = runtime.collectAdminWorkbenchOpsAlertUnifiedSummaryDraft({
        summary_enabled: false,
        work_hours_only_enabled: true,
        summary_schedule_mode: 'rolling_window',
        summary_window_minutes: 60,
        summary_hourly_minute: 0,
        summary_daily_hour: 9,
        summary_daily_minute: 0,
        summary_max_items: 10
    }, {
        document: documentRef,
        normalizeScheduleMode: (value, fallbackValue = 'rolling_window') => String(value || fallbackValue).trim().toLowerCase() || fallbackValue,
        clamp: (value, min, max) => Math.min(max, Math.max(min, Number(value || 0))),
        toWholeNumber: (value, fallbackValue = 0) => {
            const parsed = Number.parseInt(value, 10);
            return Number.isFinite(parsed) ? parsed : fallbackValue;
        }
    });

    assert.deepEqual(JSON.parse(JSON.stringify(draft)), {
        summary_enabled: true,
        work_hours_only_enabled: false,
        summary_schedule_mode: 'hourly',
        summary_window_minutes: 95,
        summary_hourly_minute: 42,
        summary_daily_hour: 11,
        summary_daily_minute: 17,
        summary_max_items: 18
    });
});

test('shared admin workbench builds ops alert unified summary consensus and control state', () => {
    const runtime = loadAdminWorkbenchRuntime();
    const definitions = [
        { key: 'customer_chat_message', supports_work_hours_only: true },
        { key: 'shop_inventory', supports_work_hours_only: false }
    ];

    const consensus = runtime.buildAdminWorkbenchOpsAlertUnifiedSummaryConsensus({
        customer_chat_message: {
            summary_enabled: true,
            work_hours_only_enabled: true,
            summary_schedule_mode: 'hourly',
            summary_window_minutes: 90,
            summary_hourly_minute: 12,
            summary_daily_hour: 9,
            summary_daily_minute: 30,
            summary_max_items: 10
        },
        shop_inventory: {
            summary_enabled: true,
            summary_schedule_mode: 'hourly',
            summary_window_minutes: 90,
            summary_hourly_minute: 12,
            summary_daily_hour: 9,
            summary_daily_minute: 30,
            summary_max_items: 10
        }
    }, {
        definitions,
        selectedDefinitions: definitions,
        defaults: {
            customer_chat_message: {},
            shop_inventory: {}
        },
        normalizeScheduleMode: (value, fallbackValue = 'rolling_window') => String(value || fallbackValue).trim().toLowerCase() || fallbackValue,
        clamp: (value, min, max) => Math.min(max, Math.max(min, Number(value || 0))),
        toWholeNumber: (value, fallbackValue = 0) => {
            const parsed = Number.parseInt(value, 10);
            return Number.isFinite(parsed) ? parsed : fallbackValue;
        }
    });

    assert.deepEqual(JSON.parse(JSON.stringify(consensus)), {
        summary_enabled: true,
        work_hours_only_enabled: true,
        summary_schedule_mode: 'hourly',
        summary_window_minutes: 90,
        summary_hourly_minute: 12,
        summary_daily_hour: 9,
        summary_daily_minute: 30,
        summary_max_items: 10
    });

    const controlState = runtime.buildAdminWorkbenchOpsAlertUnifiedSummaryDraftControlState({
        summary_enabled: true,
        summary_schedule_mode: 'daily',
        summary_daily_hour: 10,
        summary_daily_minute: 5,
        summary_max_items: 12
    }, {
        selectedCount: 3,
        formatCount: (value) => `COUNT:${value}`,
        buildSummaryModeControlState: () => ({ hintText: 'hint', rows: {} })
    });

    assert.deepEqual(JSON.parse(JSON.stringify(controlState)), {
        selectedCount: 3,
        applyDisabled: false,
        applyLabel: '应用到所选告警（COUNT:3 类）',
        summaryModeControlState: {
            hintText: 'hint',
            rows: {}
        }
    });
});

test('shared admin workbench builds ops alert summary mode control state', () => {
    const runtime = loadAdminWorkbenchRuntime();
    const state = runtime.buildAdminWorkbenchOpsAlertSummaryModeControlState({
        enabled: true,
        summary_enabled: true,
        summary_schedule_mode: 'daily',
        summary_window_minutes: 90,
        summary_hourly_minute: 25,
        summary_daily_hour: 9,
        summary_daily_minute: 30
    }, {
        normalizeScheduleMode: (value, fallbackValue = 'rolling_window') => String(value || fallbackValue).trim().toLowerCase() || fallbackValue,
        getHintText: () => 'HINT:DAILY'
    });

    assert.deepEqual(JSON.parse(JSON.stringify(state)), {
        scheduleMode: 'daily',
        summaryInputsEnabled: true,
        scheduleModeDisabled: false,
        summaryMaxItemsDisabled: false,
        summaryWindowMinutesDisabled: true,
        summaryHourlyMinuteDisabled: true,
        summaryDailyHourDisabled: false,
        summaryDailyMinuteDisabled: false,
        rows: {
            summaryWindowMinutesVisible: false,
            summaryHourlyMinuteVisible: false,
            summaryDailyHourVisible: true,
            summaryDailyMinuteVisible: true
        },
        hintText: 'HINT:DAILY',
        hintDisabled: false
    });
});

test('shared admin workbench builds ops alert summary orchestration render state', () => {
    const runtime = loadAdminWorkbenchRuntime();
    const definitions = [
        {
            key: 'shop_inventory',
            label: '库存与补货',
            supports_work_hours_only: false,
            monitor_status_id: 'monitor-shop_inventory',
            work_hours_status_id: 'workhours-shop_inventory',
            summary_status_id: 'summary-shop_inventory'
        },
        {
            key: 'tickets',
            label: '工单 SLA',
            supports_work_hours_only: true,
            monitor_status_id: 'monitor-tickets',
            work_hours_status_id: 'workhours-tickets',
            summary_status_id: 'summary-tickets'
        }
    ];

    const renderState = runtime.buildAdminWorkbenchOpsAlertSummaryOrchestrationRenderState({
        work_hours: {
            enabled: true,
            start_hour: 9,
            end_hour: 18,
            timezone: 'Asia/Shanghai'
        },
        shop_inventory: {
            enabled: true,
            low_stock_threshold: 6,
            sweep_interval_ms: 15 * 60 * 1000,
            summary_enabled: false
        },
        tickets: {
            enabled: true,
            pending_overdue_minutes: 45,
            sweep_interval_ms: 10 * 60 * 1000,
            summary_enabled: true,
            work_hours_only_enabled: true,
            summary_schedule_mode: 'hourly',
            summary_hourly_minute: 15,
            summary_max_items: 12
        }
    }, {
        definitions,
        defaults: {
            work_hours: {
                enabled: false,
                start_hour: 9,
                end_hour: 18,
                timezone: 'Asia/Shanghai'
            },
            shop_inventory: {},
            tickets: {}
        },
        selectedDefinitions: [definitions[1]],
        formatCount: (value) => `COUNT:${value}`,
        formatHourMinute: (hour, minute) => `${String(Number(hour || 0)).padStart(2, '0')}:${String(Number(minute || 0)).padStart(2, '0')}`,
        formatSummaryScheduleDescription: (section) => `MODE:${section.summary_schedule_mode || 'rolling_window'}`
    });

    assert.deepEqual(JSON.parse(JSON.stringify(renderState.counts)), {
        total: 2,
        enabledMonitorCount: 2,
        summaryEnabledCount: 1,
        workHoursOnlyCount: 1,
        selectedCount: 1
    });
    assert.equal(renderState.metaText, '共 COUNT:2 类告警：COUNT:2 类已启用主监控，COUNT:1 类已启用定时汇总，COUNT:1 类启用工作时段顺延。当前已勾选 COUNT:1 类用于批量应用。');
    assert.equal(renderState.overviewSelectionText, '已勾选 COUNT:1 类');
    assert.deepEqual(JSON.parse(JSON.stringify(renderState.definitionStates)), [
        {
            key: 'shop_inventory',
            label: '库存与补货',
            selected: false,
            monitorState: {
                cellId: 'monitor-shop_inventory',
                tone: 'success',
                label: '已启用',
                text: '巡检 COUNT:15 分钟，低库存阈值 COUNT:6。'
            },
            workHoursState: {
                cellId: 'workhours-shop_inventory',
                tone: 'neutral',
                label: '不适用',
                text: '当前库存类只支持定时汇总，不支持按工作时段顺延。'
            },
            summaryState: {
                cellId: 'summary-shop_inventory',
                tone: 'neutral',
                label: '即时通知',
                text: '当前不走固定汇总，命中后按原节奏直接外发。'
            }
        },
        {
            key: 'tickets',
            label: '工单 SLA',
            selected: true,
            monitorState: {
                cellId: 'monitor-tickets',
                tone: 'success',
                label: '已启用',
                text: '巡检 COUNT:10 分钟，超时阈值 COUNT:45 分钟。'
            },
            workHoursState: {
                cellId: 'workhours-tickets',
                tone: 'success',
                label: '已顺延',
                text: '非工作时段会顺延到 09:00 开始，工作时段 09:00-18:00（Asia/Shanghai）。'
            },
            summaryState: {
                cellId: 'summary-tickets',
                tone: 'success',
                label: '已启用汇总',
                text: 'MODE:hourly，最多 COUNT:12 条。 非工作时段仍会顺延到上班时间。'
            }
        }
    ]);
});

test('shared admin workbench builds ops alert monitor control state', () => {
    const runtime = loadAdminWorkbenchRuntime();
    const state = runtime.buildAdminWorkbenchOpsAlertMonitorControlState({
        enabled: false,
        summary_enabled: true,
        work_hours_only_enabled: true,
        recovery_notification_enabled: true,
        incident_enabled: false
    }, {
        summaryToggleDisabledWhenMonitorDisabled: true,
        extraToggleKeys: ['recovery_notification_enabled', 'incident_enabled'],
        extraToggleDisabledWhenMonitorDisabledKeys: ['recovery_notification_enabled', 'incident_enabled']
    });

    assert.deepEqual(JSON.parse(JSON.stringify(state)), {
        enabledActive: false,
        inputsDisabled: true,
        summaryToggle: {
            active: true,
            disabled: true
        },
        workHoursOnlyToggle: {
            active: true,
            disabled: true
        },
        extraToggles: {
            recovery_notification_enabled: {
                active: true,
                disabled: true
            },
            incident_enabled: {
                active: false,
                disabled: true
            }
        }
    });
});

test('shared admin workbench builds ops alert shop risk control state', () => {
    const runtime = loadAdminWorkbenchRuntime();
    const state = runtime.buildAdminWorkbenchOpsAlertShopRiskControlState({
        auto_response_enabled: false
    });

    assert.deepEqual(JSON.parse(JSON.stringify(state)), {
        autoResponseToggle: {
            active: false
        },
        thresholdInputsDisabled: true
    });
});

test('shared admin workbench builds ops alert risk spotlight state', () => {
    const runtime = loadAdminWorkbenchRuntime();
    const state = runtime.buildAdminWorkbenchOpsAlertRiskSpotlightState({
        latest_state: 'active',
        visible_items: [{
            response_summary: '最近一笔订单风险分数超过阈值，需要优先人工复核。'
        }],
        case_summary: {
            open: 2,
            claimed: 1,
            resolved: 0
        },
        thresholds: {
            auto_response_enabled: true,
            auto_disable_coupon_min_risk_score: 90,
            auto_ban_user_min_risk_score: 96,
            auto_ban_user_duration_days: 7,
            auto_suspend_product_min_risk_score: 97
        },
        recent_threshold_hits: [{
            action_label: '阈值命中',
            reference_label: '优惠码',
            reference_value: 'SPRING2026',
            risk_score: 98,
            threshold: 90,
            summary: '同一优惠码命中异常使用峰值',
            created_at: '2026-04-01T10:00:00.000Z',
            status_label: '待复核',
            status: 'pending'
        }],
        recent_auto_responses: [{
            action_label: '自动停券',
            target: 'SPRING2026',
            summary: '已先行暂停高风险优惠码',
            created_at: '2026-04-01T10:05:00.000Z',
            status_label: '已执行',
            status: 'applied'
        }]
    }, {
        severity: 'all',
        scope: 'all'
    }, {
        getCardTone: () => 'warning',
        getDisplayActiveCount: () => 3,
        getDisplayCriticalCount: () => 1,
        getAutoResponseTone: (status) => status === 'applied' ? 'success' : 'warning',
        formatCount: (value) => `#${value}`,
        formatDateTime: (value) => `FMT:${value}`
    });

    assert.deepEqual(JSON.parse(JSON.stringify(state)), {
        tone: 'warning',
        title: '当前有 #3 项商城风控信号待接手',
        summary: '最近一笔订单风险分数超过阈值，需要优先人工复核。',
        statBadges: [
            { label: '#3 待关注', tone: 'warning' },
            { label: '#2 待认领', tone: 'warning' },
            { label: '#1 处理中', tone: 'neutral' },
            { label: '#1 critical', tone: 'danger' }
        ],
        thresholdBadges: [
            { label: '自动处置开启', tone: 'warning' },
            { label: '停券 ≥ #90', tone: 'neutral' },
            { label: '封禁 ≥ #96', tone: 'neutral' },
            { label: '封禁 #7 天', tone: 'neutral' },
            { label: '下架 ≥ #97', tone: 'neutral' }
        ],
        sections: {
            threshold: {
                title: '最近阈值命中',
                emptyMessage: '最近没有新的风控阈值命中记录。',
                items: [{
                    title: '阈值命中 · SPRING2026',
                    statusLabel: '待复核',
                    statusTone: 'warning',
                    summary: '同一优惠码命中异常使用峰值',
                    meta: '分数 #98 / 阈值 #90 · FMT:2026-04-01T10:00:00.000Z'
                }]
            },
            auto: {
                title: '最近自动处置',
                emptyMessage: '最近没有新的自动停券、封禁或下架记录。',
                items: [{
                    title: '自动停券 · SPRING2026',
                    statusLabel: '已执行',
                    statusTone: 'success',
                    summary: '已先行暂停高风险优惠码',
                    meta: 'FMT:2026-04-01T10:05:00.000Z'
                }]
            }
        }
    });

    const renderState = runtime.buildAdminWorkbenchOpsAlertRiskSpotlightRenderState({
        key: 'shop_risk',
        latest_state: 'active',
        visible_items: [{
            alert_type: 'shop_order_risk_anomaly',
            target_id: 'shop_order_risk:coupon:SPRING2026',
            title: '高风险优惠码',
            reference_label: '优惠码',
            reference_value: 'SPRING2026',
            discount_code: 'SPRING2026',
            signal_type: 'coupon',
            response_summary: '最近一笔订单风险分数超过阈值，需要优先人工复核。'
        }],
        case_summary: {
            open: 2,
            claimed: 1,
            resolved: 0
        },
        thresholds: {
            auto_response_enabled: true,
            auto_disable_coupon_min_risk_score: 90,
            auto_ban_user_min_risk_score: 96,
            auto_ban_user_duration_days: 7,
            auto_suspend_product_min_risk_score: 97
        },
        recent_threshold_hits: [{
            action_label: '阈值命中',
            reference_label: '优惠码',
            reference_value: 'SPRING2026',
            risk_score: 98,
            threshold: 90,
            summary: '同一优惠码命中异常使用峰值',
            created_at: '2026-04-01T10:00:00.000Z',
            status_label: '待复核',
            status: 'pending'
        }]
    }, {
        severity: 'all',
        scope: 'all'
    }, {
        getCardTone: () => 'warning',
        getDisplayActiveCount: () => 3,
        getDisplayCriticalCount: () => 1,
        getAutoResponseTone: (status) => status === 'applied' ? 'success' : 'warning',
        getCategoryActions: () => [{ target: 'shop-risk-orders', label: '风险订单', icon: 'fas fa-bag-shopping' }],
        getQuickAction: () => ({ action: 'disable-coupon', label: '一键停用优惠码', icon: 'fas fa-ban' }),
        formatCount: (value) => `#${value}`,
        formatDateTime: (value) => `FMT:${value}`
    });

    assert.equal(renderState.actions.length, 3);
    assert.deepEqual(JSON.parse(JSON.stringify(renderState.actions[0])), {
        actionName: 'settings-copy-ops-alert-monitor-category',
        icon: 'fas fa-list-check',
        label: '复制商城风控清单',
        attrs: {
            'data-ops-alert-monitor-category-key': 'shop_risk'
        }
    });
    assert.deepEqual(JSON.parse(JSON.stringify(renderState.actions[1])), {
        actionName: 'settings-handle-shop-risk-action',
        icon: 'fas fa-ban',
        label: '一键停用优惠码',
        attrs: {
            'data-shop-risk-action': 'disable-coupon',
            'data-title': '高风险优惠码',
            'data-alert-type': 'shop_order_risk_anomaly',
            'data-category': 'shop_risk',
            'data-reference-label': '优惠码',
            'data-reference-value': 'SPRING2026',
            'data-target-id': 'shop_order_risk:coupon:SPRING2026',
            'data-user-id': '',
            'data-client-ip': '',
            'data-discount-code': 'SPRING2026',
            'data-signal-type': 'coupon',
            'data-session-id': '',
            'data-case-status': '',
            'data-case-owner-admin-id': '',
            'data-case-owner-label': ''
        }
    });
    assert.deepEqual(JSON.parse(JSON.stringify(renderState.actions[2])), {
        actionName: 'settings-open-ops-alert-workspace',
        icon: 'fas fa-bag-shopping',
        label: '风险订单',
        attrs: {
            'data-workspace-target': 'shop-risk-orders'
        }
    });

    const shellState = runtime.buildAdminWorkbenchOpsAlertRiskSpotlightShellState('error', {
        message: '商城风控快照暂时不可用'
    });
    assert.deepEqual(JSON.parse(JSON.stringify(shellState)), {
        status: 'error',
        tone: 'danger',
        eyebrow: '商城风控优先处理',
        title: '商城风控快照加载失败',
        summary: '商城风控快照暂时不可用',
        statBadges: [
            { label: '加载失败', tone: 'danger' }
        ],
        actions: [
            {
                actionName: 'settings-refresh-ops-alert-monitor',
                icon: 'fas fa-rotate',
                label: '刷新面板',
                attrs: {}
            },
            {
                actionName: 'settings-open-ops-alert-workspace',
                icon: 'fas fa-bag-shopping',
                label: '风险订单',
                attrs: {
                    'data-workspace-target': 'shop-risk-orders'
                }
            }
        ]
    });
});

test('shared admin workbench builds ops alert monitor filter toolbar state', () => {
    const runtime = loadAdminWorkbenchRuntime();
    const toolbarState = runtime.buildAdminWorkbenchOpsAlertMonitorFilterToolbarState({
        scope: 'active',
        severity: 'critical',
        category: 'shop_risk'
    }, {
        definitions: [
            { kind: 'scope', value: 'all' },
            { kind: 'scope', value: 'active' },
            { kind: 'severity', value: 'critical' },
            { kind: 'category', value: 'payments' },
            { kind: 'category', value: 'shop_risk' }
        ]
    });

    assert.deepEqual(JSON.parse(JSON.stringify(toolbarState)), [
        { kind: 'scope', value: 'all', active: false },
        { kind: 'scope', value: 'active', active: true },
        { kind: 'severity', value: 'critical', active: true },
        { kind: 'category', value: 'payments', active: false },
        { kind: 'category', value: 'shop_risk', active: true }
    ]);
});

test('shared admin workbench builds ops alert monitor aggregated view state', () => {
    const runtime = loadAdminWorkbenchRuntime();
    const viewState = runtime.buildAdminWorkbenchOpsAlertMonitorViewState({
        status: 'ready',
        summary: {
            lookback_hours: 72
        }
    }, {
        scope: 'active',
        severity: 'critical',
        category: 'payments'
    }, [{
        key: 'payments',
        display_active_count: 2,
        display_critical_count: 1,
        visible_items: [{ id: 'a' }, { id: 'b' }]
    }], {
        filterDefinitions: [
            { kind: 'scope', value: 'all' },
            { kind: 'scope', value: 'active' },
            { kind: 'severity', value: 'critical' },
            { kind: 'category', value: 'payments' }
        ],
        formatCount: (value) => `#${value}`,
        getFilterSummaryLabel: () => '仅待处理 · 仅 critical · 支付与退款',
        buildBatchItems: (_categories, action) => {
            if (action === 'assign') return [{ id: 1 }];
            if (action === 'resolve') return [{ id: 2 }, { id: 3 }];
            return [];
        },
        getBatchMuteModuleKeys: () => ['payments']
    });

    assert.deepEqual(JSON.parse(JSON.stringify(viewState)), {
        toolbarState: [
            { kind: 'scope', value: 'all', active: false },
            { kind: 'scope', value: 'active', active: true },
            { kind: 'severity', value: 'critical', active: true },
            { kind: 'category', value: 'payments', active: true }
        ],
        panelState: {
            status: 'ready',
            filteredActiveCount: 2,
            filteredCriticalCount: 1,
            filteredSummaryLabel: '仅待处理 · 仅 critical · 支付与退款',
            metaIcon: 'fas fa-siren-on',
            metaText: '当前筛选：仅待处理 · 仅 critical · 支付与退款。命中 #2 项待关注告警，覆盖 #1 个模块，其中 #1 项为 critical。',
            emptyMessage: ''
        },
        batchActionStates: [
            {
                actionName: 'settings-batch-claim-ops-alert-monitor',
                count: 1,
                disabled: false,
                title: '当前筛选将指派 #1 条告警'
            },
            {
                actionName: 'settings-batch-note-ops-alert-monitor',
                count: 0,
                disabled: true,
                title: '当前筛选条件下没有可备注的告警'
            },
            {
                actionName: 'settings-batch-resolve-ops-alert-monitor',
                count: 2,
                disabled: false,
                title: '当前筛选将关闭 #2 条告警'
            },
            {
                actionName: 'settings-batch-mute-ops-alert-monitor',
                count: 1,
                disabled: false,
                title: '当前筛选将静默 #1 个告警模块'
            }
        ]
    });
});

test('shared admin workbench collects ops alert operational threshold drafts from settings controls', () => {
    const runtime = loadAdminWorkbenchRuntime();
    const createToggle = (active) => ({
        classList: {
            contains(className) {
                return className === 'active' ? active : false;
            }
        }
    });
    const createInput = (value) => ({ value });
    const elements = new Map([
        ['opsAlertShopRiskAutoResponseEnabledToggle', createToggle(true)],
        ['opsAlertShopRiskAutoDisableCouponMinRiskScore', createInput('91')],
        ['opsAlertShopRiskAutoBanUserMinRiskScore', createInput('96')],
        ['opsAlertShopRiskAutoBanUserDurationDays', createInput('14')],
        ['opsAlertShopRiskAutoSuspendProductMinRiskScore', createInput('97')],
        ['opsAlertShopInventoryEnabledToggle', createToggle(true)],
        ['opsAlertShopInventoryLowStockThreshold', createInput('7')],
        ['opsAlertShopInventorySweepIntervalMinutes', createInput('12')],
        ['opsAlertShopInventorySalesWindowDays', createInput('45')],
        ['opsAlertShopInventoryDedupeWindowMinutes', createInput('90')],
        ['opsAlertShopInventoryRecoveryNotificationEnabledToggle', createToggle(false)],
        ['opsAlertShopInventorySummaryEnabledToggle', createToggle(true)],
        ['opsAlertShopInventorySummaryWindowMinutes', createInput('180')],
        ['opsAlertShopInventorySummaryScheduleMode', createInput('daily')],
        ['opsAlertShopInventorySummaryHourlyMinute', createInput('25')],
        ['opsAlertShopInventorySummaryDailyHour', createInput('9')],
        ['opsAlertShopInventorySummaryDailyMinute', createInput('40')],
        ['opsAlertShopInventorySummaryMaxItems', createInput('12')],
        ['opsAlertCustomerChatMessageEnabledToggle', createToggle(true)],
        ['opsAlertCustomerChatMessageSweepIntervalMinutes', createInput('7')],
        ['opsAlertCustomerChatMessageLookbackMinutes', createInput('180')],
        ['opsAlertCustomerChatMessageDedupeWindowMinutes', createInput('45')],
        ['opsAlertCustomerChatMessageWorkHoursOnlyEnabledToggle', createToggle(true)],
        ['opsAlertCustomerChatMessageSummaryEnabledToggle', createToggle(false)],
        ['opsAlertCustomerChatMessageSummaryWindowMinutes', createInput('120')],
        ['opsAlertCustomerChatMessageSummaryScheduleMode', createInput('daily')],
        ['opsAlertCustomerChatMessageSummaryHourlyMinute', createInput('15')],
        ['opsAlertCustomerChatMessageSummaryDailyHour', createInput('10')],
        ['opsAlertCustomerChatMessageSummaryDailyMinute', createInput('5')],
        ['opsAlertCustomerChatMessageSummaryMaxItems', createInput('16')],
        ['opsAlertShopPurchaseSuccessEnabledToggle', createToggle(true)],
        ['opsAlertShopPurchaseSuccessSweepIntervalMinutes', createInput('9')],
        ['opsAlertShopPurchaseSuccessLookbackMinutes', createInput('150')],
        ['opsAlertShopPurchaseSuccessDedupeWindowMinutes', createInput('30')],
        ['opsAlertShopPurchaseSuccessWorkHoursOnlyEnabledToggle', createToggle(false)],
        ['opsAlertShopPurchaseSuccessSummaryEnabledToggle', createToggle(true)],
        ['opsAlertShopPurchaseSuccessSummaryWindowMinutes', createInput('180')],
        ['opsAlertShopPurchaseSuccessSummaryScheduleMode', createInput('hourly')],
        ['opsAlertShopPurchaseSuccessSummaryHourlyMinute', createInput('20')],
        ['opsAlertShopPurchaseSuccessSummaryDailyHour', createInput('14')],
        ['opsAlertShopPurchaseSuccessSummaryDailyMinute', createInput('10')],
        ['opsAlertShopPurchaseSuccessSummaryMaxItems', createInput('18')],
        ['opsAlertWalletRechargeSuccessEnabledToggle', createToggle(false)],
        ['opsAlertWalletRechargeSuccessSweepIntervalMinutes', createInput('11')],
        ['opsAlertWalletRechargeSuccessLookbackMinutes', createInput('240')],
        ['opsAlertWalletRechargeSuccessDedupeWindowMinutes', createInput('50')],
        ['opsAlertWalletRechargeSuccessWorkHoursOnlyEnabledToggle', createToggle(true)],
        ['opsAlertWalletRechargeSuccessSummaryEnabledToggle', createToggle(true)],
        ['opsAlertWalletRechargeSuccessSummaryWindowMinutes', createInput('200')],
        ['opsAlertWalletRechargeSuccessSummaryScheduleMode', createInput('daily')],
        ['opsAlertWalletRechargeSuccessSummaryHourlyMinute', createInput('30')],
        ['opsAlertWalletRechargeSuccessSummaryDailyHour', createInput('16')],
        ['opsAlertWalletRechargeSuccessSummaryDailyMinute', createInput('35')],
        ['opsAlertWalletRechargeSuccessSummaryMaxItems', createInput('13')],
        ['opsAlertTicketsEnabledToggle', createToggle(true)],
        ['opsAlertTicketsSweepIntervalMinutes', createInput('8')],
        ['opsAlertTicketsPendingOverdueMinutes', createInput('30')],
        ['opsAlertTicketsCriticalOverdueMinutes', createInput('90')],
        ['opsAlertTicketsStateLookbackMinutes', createInput('240')],
        ['opsAlertTicketsDedupeWindowMinutes', createInput('120')],
        ['opsAlertTicketsWorkHoursOnlyEnabledToggle', createToggle(true)],
        ['opsAlertTicketsSummaryEnabledToggle', createToggle(false)],
        ['opsAlertTicketsSummaryWindowMinutes', createInput('60')],
        ['opsAlertTicketsSummaryScheduleMode', createInput('hourly')],
        ['opsAlertTicketsSummaryHourlyMinute', createInput('10')],
        ['opsAlertTicketsSummaryDailyHour', createInput('18')],
        ['opsAlertTicketsSummaryDailyMinute', createInput('0')],
        ['opsAlertTicketsSummaryMaxItems', createInput('20')],
        ['opsAlertShopOrderDeliveryEnabledToggle', createToggle(true)],
        ['opsAlertShopOrderDeliveryLookbackDays', createInput('3')],
        ['opsAlertShopOrderDeliveryStateLookbackMinutes', createInput('90')],
        ['opsAlertShopOrderDeliveryRetryWaitingMinAttempts', createInput('2')],
        ['opsAlertShopOrderDeliverySweepIntervalMinutes', createInput('13')],
        ['opsAlertShopOrderDeliveryDedupeWindowMinutes', createInput('75')],
        ['opsAlertShopOrderDeliveryIncidentEnabledToggle', createToggle(true)],
        ['opsAlertShopOrderDeliveryIncidentMinOrderCount', createInput('5')],
        ['opsAlertShopOrderDeliveryIncidentMinDeadLetterCount', createInput('2')],
        ['opsAlertShopOrderDeliveryIncidentMinDistinctUsers', createInput('3')],
        ['opsAlertShopOrderDeliveryIncidentDedupeWindowMinutes', createInput('180')],
        ['opsAlertShopOrderDeliveryWorkHoursOnlyEnabledToggle', createToggle(false)],
        ['opsAlertShopOrderDeliverySummaryEnabledToggle', createToggle(true)],
        ['opsAlertShopOrderDeliverySummaryWindowMinutes', createInput('210')],
        ['opsAlertShopOrderDeliverySummaryScheduleMode', createInput('daily')],
        ['opsAlertShopOrderDeliverySummaryHourlyMinute', createInput('40')],
        ['opsAlertShopOrderDeliverySummaryDailyHour', createInput('8')],
        ['opsAlertShopOrderDeliverySummaryDailyMinute', createInput('55')],
        ['opsAlertShopOrderDeliverySummaryMaxItems', createInput('10')],
        ['opsAlertVerifyQuotaEnabledToggle', createToggle(true)],
        ['opsAlertVerifyQuotaLowBalanceThreshold', createInput('500')],
        ['opsAlertVerifyQuotaLowRemainingJobsThreshold', createInput('25')],
        ['opsAlertVerifyQuotaCriticalBalanceThreshold', createInput('100')],
        ['opsAlertVerifyQuotaCriticalRemainingJobsThreshold', createInput('10')],
        ['opsAlertVerifyQuotaMinQueueBufferJobs', createInput('15')],
        ['opsAlertVerifyQuotaSweepIntervalMinutes', createInput('20')],
        ['opsAlertVerifyQuotaDedupeWindowMinutes', createInput('60')],
        ['opsAlertVerifyQuotaWorkHoursOnlyEnabledToggle', createToggle(false)],
        ['opsAlertVerifyQuotaSummaryEnabledToggle', createToggle(true)],
        ['opsAlertVerifyQuotaSummaryWindowMinutes', createInput('240')],
        ['opsAlertVerifyQuotaSummaryScheduleMode', createInput('daily')],
        ['opsAlertVerifyQuotaSummaryHourlyMinute', createInput('5')],
        ['opsAlertVerifyQuotaSummaryDailyHour', createInput('11')],
        ['opsAlertVerifyQuotaSummaryDailyMinute', createInput('15')],
        ['opsAlertVerifyQuotaSummaryMaxItems', createInput('8')],
        ['opsAlertVerifyQueueEnabledToggle', createToggle(true)],
        ['opsAlertVerifyQueueRecentActivityLookbackHours', createInput('12')],
        ['opsAlertVerifyQueueRecentFailureWindowMinutes', createInput('20')],
        ['opsAlertVerifyQueueSizeThreshold', createInput('40')],
        ['opsAlertVerifyQueueActiveJobThreshold', createInput('8')],
        ['opsAlertVerifyQueueOldestPendingMinutesThreshold', createInput('35')],
        ['opsAlertVerifyQueueRecentFailureThreshold', createInput('6')],
        ['opsAlertVerifyQueueSweepIntervalMinutes', createInput('14')],
        ['opsAlertVerifyQueueDedupeWindowMinutes', createInput('70')],
        ['opsAlertVerifyQueueWorkHoursOnlyEnabledToggle', createToggle(true)],
        ['opsAlertVerifyQueueSummaryEnabledToggle', createToggle(true)],
        ['opsAlertVerifyQueueSummaryWindowMinutes', createInput('90')],
        ['opsAlertVerifyQueueSummaryScheduleMode', createInput('hourly')],
        ['opsAlertVerifyQueueSummaryHourlyMinute', createInput('35')],
        ['opsAlertVerifyQueueSummaryDailyHour', createInput('13')],
        ['opsAlertVerifyQueueSummaryDailyMinute', createInput('20')],
        ['opsAlertVerifyQueueSummaryMaxItems', createInput('14')],
        ['opsAlertVerifyFailureEnabledToggle', createToggle(true)],
        ['opsAlertVerifyFailureRecentWindowMinutes', createInput('30')],
        ['opsAlertVerifyFailureMinTotalJobsThreshold', createInput('50')],
        ['opsAlertVerifyFailureRateThreshold', createInput('18')],
        ['opsAlertVerifyFailureAffectedUserThreshold', createInput('6')],
        ['opsAlertVerifyFailureSweepIntervalMinutes', createInput('16')],
        ['opsAlertVerifyFailureDedupeWindowMinutes', createInput('55')],
        ['opsAlertVerifyFailureWorkHoursOnlyEnabledToggle', createToggle(false)],
        ['opsAlertVerifyFailureSummaryEnabledToggle', createToggle(true)],
        ['opsAlertVerifyFailureSummaryWindowMinutes', createInput('120')],
        ['opsAlertVerifyFailureSummaryScheduleMode', createInput('daily')],
        ['opsAlertVerifyFailureSummaryHourlyMinute', createInput('45')],
        ['opsAlertVerifyFailureSummaryDailyHour', createInput('17')],
        ['opsAlertVerifyFailureSummaryDailyMinute', createInput('25')],
        ['opsAlertVerifyFailureSummaryMaxItems', createInput('9')],
        ['opsAlertPaymentGatewayEnabledToggle', createToggle(true)],
        ['opsAlertPaymentGatewayWindowMinutes', createInput('15')],
        ['opsAlertPaymentGatewayFailedOrdersThreshold', createInput('4')],
        ['opsAlertPaymentGatewayFailedRatioThreshold', createInput('30')],
        ['opsAlertPaymentGatewayWebhookSuccessRateThreshold', createInput('85')],
        ['opsAlertPaymentGatewayQuerySuccessRateThreshold', createInput('80')],
        ['opsAlertPaymentGatewayWebhook5xxThreshold', createInput('3')],
        ['opsAlertPaymentGatewayQuery5xxThreshold', createInput('2')],
        ['opsAlertPaymentGatewaySweepIntervalMinutes', createInput('18')],
        ['opsAlertPaymentGatewayDedupeWindowMinutes', createInput('65')],
        ['opsAlertPaymentGatewayWorkHoursOnlyEnabledToggle', createToggle(true)],
        ['opsAlertPaymentGatewaySummaryEnabledToggle', createToggle(false)],
        ['opsAlertPaymentGatewaySummaryWindowMinutes', createInput('75')],
        ['opsAlertPaymentGatewaySummaryScheduleMode', createInput('hourly')],
        ['opsAlertPaymentGatewaySummaryHourlyMinute', createInput('50')],
        ['opsAlertPaymentGatewaySummaryDailyHour', createInput('20')],
        ['opsAlertPaymentGatewaySummaryDailyMinute', createInput('10')],
        ['opsAlertPaymentGatewaySummaryMaxItems', createInput('11')]
    ]);
    const documentRef = {
        getElementById(id) {
            return elements.get(id) || null;
        }
    };

    const draft = runtime.collectAdminWorkbenchOpsAlertOperationalThresholdDrafts({
        shop_order_risk: { auto_response_enabled: false, auto_suspend_product_min_risk_score: 88 },
        shop_inventory: { enabled: false, summary_schedule_mode: 'hourly', summary_max_items: 1, sweep_interval_ms: 60000 },
        customer_chat_message: { enabled: false, summary_schedule_mode: 'hourly', summary_max_items: 15, sweep_interval_ms: 60000 },
        shop_purchase_success: { enabled: false, summary_schedule_mode: 'daily', summary_max_items: 17, sweep_interval_ms: 60000 },
        wallet_recharge_success: { enabled: true, summary_schedule_mode: 'hourly', summary_max_items: 19, sweep_interval_ms: 60000 },
        tickets: { enabled: false, summary_schedule_mode: 'daily', summary_max_items: 2, sweep_interval_ms: 60000 },
        shop_order_delivery: { enabled: false, summary_schedule_mode: 'hourly', summary_max_items: 21, sweep_interval_ms: 60000 },
        verify_quota: { enabled: false, summary_schedule_mode: 'hourly', summary_max_items: 3, sweep_interval_ms: 60000 },
        verify_queue: { enabled: false, summary_schedule_mode: 'daily', summary_max_items: 4, sweep_interval_ms: 60000 },
        verify_failure: { enabled: false, summary_schedule_mode: 'hourly', summary_max_items: 5, sweep_interval_ms: 60000 },
        payment_gateway: { enabled: false, summary_schedule_mode: 'daily', summary_max_items: 6, sweep_interval_ms: 60000 }
    }, {
        document: documentRef,
        toWholeNumber: (value, fallbackValue) => {
            const parsed = Number.parseInt(value, 10);
            return Number.isFinite(parsed) ? parsed : fallbackValue;
        },
        normalizeOpsAlertSummaryScheduleMode: (value, fallbackValue) => String(value || fallbackValue).trim().toLowerCase()
    });

    assert.deepEqual(JSON.parse(JSON.stringify(draft)), {
        shop_order_risk: {
            auto_response_enabled: true,
            auto_disable_coupon_min_risk_score: 91,
            auto_ban_user_min_risk_score: 96,
            auto_ban_user_duration_days: 14,
            auto_suspend_product_min_risk_score: 97
        },
        shop_inventory: {
            enabled: true,
            low_stock_threshold: 7,
            sweep_interval_ms: 720000,
            sales_window_days: 45,
            dedupe_window_minutes: 90,
            recovery_notification_enabled: false,
            summary_enabled: true,
            summary_window_minutes: 180,
            summary_schedule_mode: 'daily',
            summary_hourly_minute: 25,
            summary_daily_hour: 9,
            summary_daily_minute: 40,
            summary_max_items: 12
        },
        customer_chat_message: {
            enabled: true,
            sweep_interval_ms: 420000,
            lookback_minutes: 180,
            dedupe_window_minutes: 45,
            work_hours_only_enabled: true,
            summary_enabled: false,
            summary_window_minutes: 120,
            summary_schedule_mode: 'daily',
            summary_hourly_minute: 15,
            summary_daily_hour: 10,
            summary_daily_minute: 5,
            summary_max_items: 16
        },
        shop_purchase_success: {
            enabled: true,
            sweep_interval_ms: 540000,
            lookback_minutes: 150,
            dedupe_window_minutes: 30,
            work_hours_only_enabled: false,
            summary_enabled: true,
            summary_window_minutes: 180,
            summary_schedule_mode: 'hourly',
            summary_hourly_minute: 20,
            summary_daily_hour: 14,
            summary_daily_minute: 10,
            summary_max_items: 18
        },
        wallet_recharge_success: {
            enabled: false,
            sweep_interval_ms: 660000,
            lookback_minutes: 240,
            dedupe_window_minutes: 50,
            work_hours_only_enabled: true,
            summary_enabled: true,
            summary_window_minutes: 200,
            summary_schedule_mode: 'daily',
            summary_hourly_minute: 30,
            summary_daily_hour: 16,
            summary_daily_minute: 35,
            summary_max_items: 13
        },
        tickets: {
            enabled: true,
            sweep_interval_ms: 480000,
            pending_overdue_minutes: 30,
            critical_overdue_minutes: 90,
            state_lookback_minutes: 240,
            dedupe_window_minutes: 120,
            work_hours_only_enabled: true,
            summary_enabled: false,
            summary_window_minutes: 60,
            summary_schedule_mode: 'hourly',
            summary_hourly_minute: 10,
            summary_daily_hour: 18,
            summary_daily_minute: 0,
            summary_max_items: 20
        },
        shop_order_delivery: {
            enabled: true,
            lookback_days: 3,
            state_lookback_minutes: 90,
            retry_waiting_min_attempts: 2,
            sweep_interval_ms: 780000,
            dedupe_window_minutes: 75,
            incident_enabled: true,
            incident_min_order_count: 5,
            incident_min_dead_letter_count: 2,
            incident_min_distinct_users: 3,
            incident_dedupe_window_minutes: 180,
            work_hours_only_enabled: false,
            summary_enabled: true,
            summary_window_minutes: 210,
            summary_schedule_mode: 'daily',
            summary_hourly_minute: 40,
            summary_daily_hour: 8,
            summary_daily_minute: 55,
            summary_max_items: 10
        },
        verify_quota: {
            enabled: true,
            low_balance_threshold: 500,
            low_remaining_jobs_threshold: 25,
            critical_balance_threshold: 100,
            critical_remaining_jobs_threshold: 10,
            min_queue_buffer_jobs: 15,
            sweep_interval_ms: 1200000,
            dedupe_window_minutes: 60,
            work_hours_only_enabled: false,
            summary_enabled: true,
            summary_window_minutes: 240,
            summary_schedule_mode: 'daily',
            summary_hourly_minute: 5,
            summary_daily_hour: 11,
            summary_daily_minute: 15,
            summary_max_items: 8
        },
        verify_queue: {
            enabled: true,
            recent_activity_lookback_hours: 12,
            recent_failure_window_minutes: 20,
            queue_size_threshold: 40,
            active_job_threshold: 8,
            oldest_pending_minutes_threshold: 35,
            recent_failure_threshold: 6,
            sweep_interval_ms: 840000,
            dedupe_window_minutes: 70,
            work_hours_only_enabled: true,
            summary_enabled: true,
            summary_window_minutes: 90,
            summary_schedule_mode: 'hourly',
            summary_hourly_minute: 35,
            summary_daily_hour: 13,
            summary_daily_minute: 20,
            summary_max_items: 14
        },
        verify_failure: {
            enabled: true,
            recent_window_minutes: 30,
            min_total_jobs_threshold: 50,
            failure_rate_threshold: 18,
            affected_user_threshold: 6,
            sweep_interval_ms: 960000,
            dedupe_window_minutes: 55,
            work_hours_only_enabled: false,
            summary_enabled: true,
            summary_window_minutes: 120,
            summary_schedule_mode: 'daily',
            summary_hourly_minute: 45,
            summary_daily_hour: 17,
            summary_daily_minute: 25,
            summary_max_items: 9
        },
        payment_gateway: {
            enabled: true,
            window_minutes: 15,
            min_failed_orders: 4,
            min_failed_ratio_percent: 30,
            max_webhook_success_rate_percent: 85,
            max_query_success_rate_percent: 80,
            min_webhook_5xx_count: 3,
            min_query_5xx_count: 2,
            sweep_interval_ms: 1080000,
            dedupe_window_minutes: 65,
            work_hours_only_enabled: true,
            summary_enabled: false,
            summary_window_minutes: 75,
            summary_schedule_mode: 'hourly',
            summary_hourly_minute: 50,
            summary_daily_hour: 20,
            summary_daily_minute: 10,
            summary_max_items: 11
        }
    });
});

test('shared admin workbench builds ops alert strategy summary state from normalized config', () => {
    const runtime = loadAdminWorkbenchRuntime();
    const summaryState = runtime.buildAdminWorkbenchOpsAlertStrategySummaryState({
        quiet_hours: {
            enabled: true,
            start_hour: 23,
            end_hour: 8
        },
        work_hours: {
            enabled: false,
            start_hour: 10,
            end_hour: 19,
            timezone: 'UTC'
        },
        mute_rules: {
            types: {
                customer_chat_message: { active: true, expired: false },
                shop_purchase_success: { active: false, expired: true }
            },
            modules: {
                commerce: { active: true, expired: false }
            }
        },
        routing: {
            customer_chat_message: { telegram: true, feishu: false, email: true },
            tickets: { telegram: true, feishu: true, email: true }
        },
        customer_chat_message: {
            work_hours_only_enabled: true
        }
    }, {
        normalizeConfig: (value) => value,
        getDefaultConfig: () => ({
            quiet_hours: {
                enabled: false,
                start_hour: 22,
                end_hour: 7
            },
            work_hours: {
                enabled: false,
                start_hour: 9,
                end_hour: 18,
                timezone: 'Asia/Shanghai'
            },
            routing: {
                customer_chat_message: { telegram: true, feishu: true, email: true },
                tickets: { telegram: true, feishu: true, email: true }
            }
        }),
        getTemporaryMuteState: () => ({
            active: false,
            expired: false,
            untilLabel: '—',
            allowCritical: true
        }),
        getMuteRuleState: (rule = {}) => ({
            active: rule.active === true,
            expired: rule.expired === true,
            untilLabel: '—',
            allowCritical: true
        }),
        typeDefinitions: [
            { key: 'customer_chat_message' },
            { key: 'shop_purchase_success' }
        ],
        moduleDefinitions: [
            { key: 'commerce' }
        ],
        routingDefinitions: [
            { key: 'customer_chat_message' },
            { key: 'tickets' }
        ],
        summaryDefinitions: [
            { key: 'customer_chat_message', supports_work_hours_only: true },
            { key: 'tickets', supports_work_hours_only: false }
        ],
        formatCount: (value) => `#${value}`,
        formatHourRange: (startHour, endHour) => `H:${startHour}-${endHour}`
    });

    assert.deepEqual(JSON.parse(JSON.stringify(summaryState)), {
        mute: {
            badgeLabel: '生效 #3 项',
            badgeTone: 'warning',
            summaryTipText: '当前有 #3 项静默策略生效，建议只保留真正需要降噪的规则。',
            panelTipText: '当前有 #3 项静默策略生效，优先处理仍在生效的规则。',
            temporaryLabel: '未设置',
            quietHoursLabel: 'H:23-8',
            rulesLabel: '#1 / #1 生效',
            typeMetaLabel: '共 #2 类，#1 类生效',
            moduleMetaLabel: '共 #1 类，#1 类生效',
            typeTabLabel: '#1 生效',
            moduleTabLabel: '#1 生效'
        },
        routing: {
            badgeLabel: '已定制 #1 类',
            badgeTone: 'success',
            summaryTipText: '已有 #1 类事件被改成非默认路由，矩阵更适合快速复核。',
            panelTipText: '已对 #1 类事件做了分流，建议重点检查核心告警是否还保留至少一条主通道。',
            matrixMetaLabel: '共 #2 类事件，已定制 #1 类',
            telegramLabel: '#2 / #2',
            feishuLabel: '#1 / #2',
            emailLabel: '#2 / #2'
        },
        work_hours: {
            badgeLabel: '待启用',
            badgeTone: 'warning',
            summaryTipText: '当前有 #1 类告警启用了“仅工作时间通知”。',
            panelTipText: '这组时间只影响开启“仅工作时间通知”的低优先级告警。',
            rangeLabel: 'H:10-19',
            timezoneLabel: 'UTC',
            rulesLabel: '#1 类'
        }
    });
});

test('shared admin workbench builds ops alert overview status from config and secret state', () => {
    const runtime = loadAdminWorkbenchRuntime();
    const overviewStatus = runtime.buildAdminWorkbenchOpsAlertOverviewStatus({
        enabled: true,
        channels: {
            telegram: {
                enabled: true,
                minimum_severity: 'critical',
                chat_ids: ['10001', '10002']
            },
            feishu: {
                enabled: true,
                minimum_severity: 'warning'
            },
            email: {
                enabled: false,
                minimum_severity: 'danger',
                recipients: ['ops@example.com', 'lead@example.com', 'backup@example.com'],
                from_address: 'sender@example.com',
                reply_to: 'reply@example.com',
                subject_prefix: '[OPS]'
            }
        }
    }, {
        telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-04-01T10:00:00.000Z' },
        feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null },
        email_api_key: { configured: true, source: 'environment', updatedAt: '2026-04-01T11:00:00.000Z' }
    }, {
        normalizeConfig: (value) => value,
        getDefaultSecretStatus: () => ({
            telegram_bot_token: { configured: false, source: 'missing', updatedAt: null },
            feishu_webhook_url: { configured: false, source: 'missing', updatedAt: null },
            email_api_key: { configured: false, source: 'missing', updatedAt: null }
        }),
        getTemporaryMuteState: () => ({
            active: true,
            expired: false,
            untilLabel: 'FMT:2026-04-01T18:00:00.000Z',
            allowCritical: true
        })
    });

    assert.deepEqual(JSON.parse(JSON.stringify(overviewStatus)), {
        normalizedConfig: {
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'critical',
                    chat_ids: ['10001', '10002']
                },
                feishu: {
                    enabled: true,
                    minimum_severity: 'warning'
                },
                email: {
                    enabled: false,
                    minimum_severity: 'danger',
                    recipients: ['ops@example.com', 'lead@example.com', 'backup@example.com'],
                    from_address: 'sender@example.com',
                    reply_to: 'reply@example.com',
                    subject_prefix: '[OPS]'
                }
            }
        },
        telegramSecret: { configured: true, source: 'stored', updatedAt: '2026-04-01T10:00:00.000Z' },
        feishuSecret: { configured: false, source: 'missing', updatedAt: null },
        emailSecret: { configured: true, source: 'environment', updatedAt: '2026-04-01T11:00:00.000Z' },
        telegramChatCount: 2,
        emailRecipientCount: 3,
        channelStates: [
            'Telegram · critical+ · 2 个 chat · 已就绪',
            '飞书 · warning+ · 待补充配置'
        ],
        deliveryIssues: [
            '飞书 Webhook 未配置'
        ],
        targetSummaries: [
            'Telegram：2 个 chat',
            '邮件：3 个收件人（ops@example.com、lead@example.com 等）',
            '发件地址：sender@example.com',
            'Reply-To：reply@example.com'
        ],
        channelOverviewItems: [
            {
                key: 'telegram',
                label: 'Telegram',
                value: '2 个 chat',
                meta: '可直接投递 · Bot Token 已配置',
                tone: 'success',
                severityLabel: 'critical+',
                statusLabel: '已就绪',
                statusTone: 'success'
            },
            {
                key: 'feishu',
                label: '飞书',
                value: '未配置 Webhook',
                meta: '启用中，仍需补齐 Webhook',
                tone: 'warning',
                severityLabel: 'warning+',
                statusLabel: '待补充',
                statusTone: 'warning'
            },
            {
                key: 'email',
                label: '邮件',
                value: '3 个收件人',
                meta: '当前为预设 · 发件地址已配置',
                tone: 'neutral',
                severityLabel: 'danger+',
                statusLabel: '未打开',
                statusTone: 'neutral'
            }
        ],
        targetOverviewItems: [
            {
                key: 'telegram',
                label: 'Telegram',
                value: '2 个 chat',
                meta: '打开后会投递到配置的 chat',
                tone: 'success',
                statusLabel: '已配置',
                statusTone: 'success'
            },
            {
                key: 'feishu',
                label: '飞书',
                value: '未配置 Webhook',
                meta: '打开后会发往群机器人',
                tone: 'warning',
                statusLabel: '待配置',
                statusTone: 'warning'
            },
            {
                key: 'email',
                label: '邮件',
                value: '3 个收件人',
                meta: '当前为预设目标',
                tone: 'success',
                statusLabel: '已配置',
                statusTone: 'success'
            }
        ],
        targetDetailRows: [
            {
                label: '发件地址',
                value: 'sender@example.com',
                tone: 'neutral'
            },
            {
                label: 'Reply-To',
                value: 'reply@example.com',
                tone: 'neutral'
            },
            {
                label: '主题前缀',
                value: '[OPS]',
                tone: 'neutral'
            }
        ],
        enabledChannelCount: 2,
        readyChannelCount: 1,
        configuredTargetChannelCount: 2,
        temporaryMuteState: {
            active: true,
            expired: false,
            untilLabel: 'FMT:2026-04-01T18:00:00.000Z',
            allowCritical: true
        },
        enabledSeveritySummary: 'Telegram critical；飞书 warning'
    });
});

test('shared admin workbench builds ops alert overview banner state from overview and health data', () => {
    const runtime = loadAdminWorkbenchRuntime();
    const bannerState = runtime.buildAdminWorkbenchOpsAlertOverviewBannerState({
        normalizedConfig: {
            enabled: true
        },
        deliveryIssues: ['飞书 Webhook 未配置'],
        enabledChannelCount: 2,
        readyChannelCount: 1,
        configuredTargetChannelCount: 2,
        temporaryMuteState: {
            active: true,
            expired: false,
            untilLabel: 'FMT:2026-04-01T18:00:00.000Z',
            allowCritical: false
        },
        enabledSeveritySummary: 'Telegram critical；飞书 warning'
    }, {
        status: 'ready',
        fetched_at: '2026-04-01T12:00:00.000Z',
        summary: {
            lookback_hours: 48,
            total_attempt_count: 20,
            failed_count: 2,
            dead_letter_count: 1
        }
    }, {
        defaultHealthState: {
            status: 'idle',
            fetched_at: '',
            summary: {
                lookback_hours: 72,
                total_attempt_count: 0,
                failed_count: 0,
                dead_letter_count: 0
            }
        },
        formatCount: (value) => `#${value}`,
        getTemporaryMuteState: () => ({
            active: false,
            expired: false,
            untilLabel: '—',
            allowCritical: true
        }),
        getEnabledSeveritySummary: () => ''
    });

    assert.deepEqual(JSON.parse(JSON.stringify(bannerState)), {
        tone: 'danger',
        icon: 'fa-circle-exclamation',
        headline: '站外告警存在死信，建议优先处理异常通道',
        detailParts: [
            '发送采用异步队列，不阻塞退款主流程。',
            '待补充：飞书 Webhook 未配置。',
            '当前级别：Telegram critical；飞书 warning。',
            '临时静默至 FMT:2026-04-01T18:00:00.000Z，所有级别暂停外发。'
        ],
        detailText: '发送采用异步队列，不阻塞退款主流程。 待补充：飞书 Webhook 未配置。 当前级别：Telegram critical；飞书 warning。 临时静默至 FMT:2026-04-01T18:00:00.000Z，所有级别暂停外发。',
        badgeItems: [
            { label: '已启用', tone: 'danger' },
            { label: '1 / 2 通道就绪', tone: 'warning' },
            { label: '已配置 2 / 3', tone: 'success' },
            { label: '近 #48h 失败 #2', tone: 'danger' },
            { label: '死信 #1', tone: 'danger' }
        ],
        canSendTest: false,
        testButtonTitle: '请先补齐通道配置',
        fetchedAt: '2026-04-01T12:00:00.000Z'
    });
});

test('shared admin workbench builds ops alert overview card states from overview and health data', () => {
    const runtime = loadAdminWorkbenchRuntime();
    const cardStates = runtime.buildAdminWorkbenchOpsAlertOverviewCardStates({
        normalizedConfig: {
            enabled: true
        },
        deliveryIssues: ['飞书 Webhook 未配置'],
        channelOverviewItems: [{ key: 'telegram' }, { key: 'feishu' }],
        targetOverviewItems: [{ key: 'telegram' }, { key: 'email' }],
        targetDetailRows: [{ label: '发件地址', value: 'sender@example.com', tone: 'neutral' }],
        enabledChannelCount: 2,
        readyChannelCount: 1,
        configuredTargetChannelCount: 2
    }, {
        status: 'ready',
        fetched_at: '2026-04-01T12:00:00.000Z',
        channels: [{ channel: 'telegram' }],
        summary: {
            lookback_hours: 48,
            total_attempt_count: 20,
            delivered_count: 17,
            failed_count: 2,
            dead_letter_count: 1,
            recent_deliveries: [
                {
                    title: '退款成功',
                    target_summary: 'ORDER-1',
                    channel: 'telegram'
                }
            ],
            recent_errors: [
                {
                    message: 'Webhook timeout',
                    channel_label: '飞书',
                    count: 2
                }
            ],
            recent_error_channels: [
                {
                    channel_label: '飞书',
                    count: 2
                }
            ]
        }
    }, {
        defaultHealthState: {
            status: 'idle',
            fetched_at: '',
            summary: {
                lookback_hours: 72,
                total_attempt_count: 0,
                delivered_count: 0,
                failed_count: 0,
                dead_letter_count: 0
            }
        },
        formatCount: (value) => `#${value}`,
        formatDateTime: (value) => `FMT:${value}`
    });

    assert.deepEqual(JSON.parse(JSON.stringify(cardStates)), {
        channelsCard: {
            tone: 'warning',
            title: '1 / 2 已就绪',
            compact: false,
            items: [{ key: 'telegram' }, { key: 'feishu' }]
        },
        targetsCard: {
            tone: 'warning',
            title: '已配置 2 / 3',
            compact: true,
            items: [{ key: 'telegram' }, { key: 'email' }],
            detailRows: [{ label: '发件地址', value: 'sender@example.com', tone: 'neutral' }],
            detailRowsCompact: true,
            includeTargetDetails: true
        },
        recentCard: {
            tone: 'danger',
            title: '近 #48 小时',
            metrics: [
                { label: '总投递', value: '#20' },
                { label: '送达率', value: '85%' },
                { label: '刷新于', value: 'FMT:2026-04-01T12:00:00.000Z' }
            ],
            detailRows: [
                { label: '最近投递', value: '退款成功 (ORDER-1) · telegram', tone: 'neutral' },
                { label: '最近失败', value: 'Webhook timeout (飞书) · #2 次', tone: 'danger' },
                { label: '异常来源', value: '飞书 #2 次', tone: 'danger' }
            ],
            emptyMessage: ''
        }
    });
});

test('shared admin workbench builds ops alert overview and health render states', () => {
    const runtime = loadAdminWorkbenchRuntime();
    const overviewRenderState = runtime.buildAdminWorkbenchOpsAlertOverviewRenderState({
        normalizedConfig: { enabled: true },
        deliveryIssues: ['飞书 Webhook 未配置'],
        channelOverviewItems: [{ key: 'telegram' }, { key: 'feishu' }],
        targetOverviewItems: [{ key: 'telegram' }],
        targetDetailRows: [{ label: '发件地址', value: 'sender@example.com', tone: 'neutral' }],
        enabledChannelCount: 2,
        readyChannelCount: 1,
        configuredTargetChannelCount: 1,
        temporaryMuteState: { active: false, expired: false, untilLabel: '—', allowCritical: true },
        enabledSeveritySummary: 'Telegram warning'
    }, {
        status: 'ready',
        fetched_at: '2026-04-01T12:00:00.000Z',
        channels: [{ key: 'telegram' }],
        summary: {
            lookback_hours: 24,
            total_attempt_count: 5,
            delivered_count: 4,
            failed_count: 1,
            dead_letter_count: 0,
            trend_bucket_hours: 6,
            recent_trend_buckets: [],
            recent_deliveries: [],
            recent_errors: [],
            recent_error_channels: []
        }
    }, {
        defaultHealthState: {
            status: 'idle',
            fetched_at: '',
            summary: {
                lookback_hours: 72,
                total_attempt_count: 0,
                delivered_count: 0,
                failed_count: 0,
                dead_letter_count: 0
            }
        },
        formatCount: (value) => `#${value}`,
        formatDateTime: (value) => `FMT:${value}`,
        getTemporaryMuteState: () => ({ active: false, expired: false, untilLabel: '—', allowCritical: true }),
        getEnabledSeveritySummary: () => 'Telegram warning'
    });
    const healthRenderState = runtime.buildAdminWorkbenchOpsAlertHealthRenderState({
        status: 'ready',
        summary: {
            lookback_hours: 24,
            total_attempt_count: 5,
            delivered_count: 4,
            failed_count: 1,
            dead_letter_count: 0
        },
        channels: [{
            key: 'telegram',
            label: 'Telegram',
            tone: 'success',
            enabled: true,
            configured: true,
            health_label: '已就绪',
            minimum_severity: 'warning',
            source: 'stored',
            recipient_summary: '2 个 chat',
            total_attempts: 5,
            delivery_rate: 80,
            dead_letter_count: 0,
            retry_count: 1,
            recent_errors: []
        }]
    }, {
        defaultHealthState: {
            status: 'idle',
            summary: {
                lookback_hours: 72,
                total_attempt_count: 0,
                delivered_count: 0,
                failed_count: 0,
                dead_letter_count: 0
            }
        },
        formatCount: (value) => `#${value}`,
        formatDateTime: (value) => `FMT:${value}`
    });

    assert.deepEqual(JSON.parse(JSON.stringify(overviewRenderState.bannerState.badgeItems)), [
        { label: '已启用', tone: 'warning' },
        { label: '1 / 2 通道就绪', tone: 'warning' },
        { label: '已配置 1 / 3', tone: 'success' },
        { label: '近 #24h 失败 #1', tone: 'warning' }
    ]);
    assert.deepEqual(JSON.parse(JSON.stringify(overviewRenderState.cardStates.channelsCard.items)), [{ key: 'telegram' }, { key: 'feishu' }]);
    assert.deepEqual(JSON.parse(JSON.stringify(overviewRenderState.recentVisualState)), {
        trendMeta: '',
        trendBuckets: [],
        trendFooterLabels: [],
        segmentMeta: '分段统计',
        segments: [
            { label: '送达', tone: 'success', valueText: '#4', shareText: '#80%' },
            { label: '失败', tone: 'warning', valueText: '#1', shareText: '#20%' },
            { label: '死信', tone: 'danger', valueText: '#0', shareText: '#0%' }
        ]
    });
    assert.equal(healthRenderState.panelState.status, 'ready');
    assert.equal(healthRenderState.channelCardStates.length, 1);
    assert.equal(healthRenderState.channelCardStates[0].label, 'Telegram');
    assert.equal(healthRenderState.channelCardStates[0].summaryText, '最近 72 小时内暂无投递记录');
});

test('shared admin workbench builds ops alert overview recent visual state from health summary', () => {
    const runtime = loadAdminWorkbenchRuntime();
    const visualState = runtime.buildAdminWorkbenchOpsAlertOverviewRecentVisualState({
        trend_bucket_hours: 6,
        recent_trend_buckets: [
            {
                bucket_start_at: '2026-04-01T00:00:00.000Z',
                bucket_end_at: '2026-04-01T06:00:00.000Z',
                delivered_count: 8,
                failed_count: 2,
                dead_letter_count: 0,
                total_count: 10
            },
            {
                bucket_start_at: '2026-04-01T06:00:00.000Z',
                bucket_end_at: '2026-04-01T12:00:00.000Z',
                delivered_count: 4,
                failed_count: 1,
                dead_letter_count: 1,
                total_count: 6
            }
        ],
        delivered_count: 12,
        failed_count: 3,
        dead_letter_count: 1
    }, 'ready', {
        formatCount: (value) => `#${value}`,
        formatBucketLabel: (value) => `FMT:${value}`
    });

    assert.deepEqual(JSON.parse(JSON.stringify(visualState)), {
        trendMeta: '72 小时趋势 · 每 #6 小时一段',
        trendBuckets: [
            {
                tooltip: 'FMT:2026-04-01T00:00:00.000Z - FMT:2026-04-01T06:00:00.000Z · 送达 #8 次 · 失败 #2 次 · 死信 #0 项',
                total: 10,
                heightPercent: 100,
                backgroundStyle: 'height:100%;background:linear-gradient(to top, rgba(52, 211, 153, 0.96) 0.00% 80.00%, rgba(251, 191, 36, 0.96) 80.00% 100.00%);',
                fillEmpty: false
            },
            {
                tooltip: 'FMT:2026-04-01T06:00:00.000Z - FMT:2026-04-01T12:00:00.000Z · 送达 #4 次 · 失败 #1 次 · 死信 #1 项',
                total: 6,
                heightPercent: 60,
                backgroundStyle: 'height:60%;background:linear-gradient(to top, rgba(52, 211, 153, 0.96) 0.00% 66.67%, rgba(251, 191, 36, 0.96) 66.67% 83.33%, rgba(248, 113, 113, 0.96) 83.33% 100.00%, rgba(107, 158, 206, 0.18) 100.00% 100%);',
                fillEmpty: false
            }
        ],
        trendFooterLabels: [
            'FMT:2026-04-01T00:00:00.000Z',
            'FMT:2026-04-01T00:00:00.000Z',
            'FMT:2026-04-01T12:00:00.000Z'
        ],
        segmentMeta: '分段统计',
        segments: [
            { label: '送达', tone: 'success', valueText: '#12', shareText: '#75%' },
            { label: '失败', tone: 'warning', valueText: '#3', shareText: '#19%' },
            { label: '死信', tone: 'danger', valueText: '#1', shareText: '#6%' }
        ]
    });
});

test('shared admin workbench builds ops alert health card and panel state', () => {
    const runtime = loadAdminWorkbenchRuntime();
    const cardState = runtime.buildAdminWorkbenchOpsAlertHealthCardState({
        key: 'email',
        label: '邮件',
        tone: 'warning',
        enabled: true,
        configured: false,
        health_label: '待补充',
        minimum_severity: 'warning',
        source: 'environment',
        recipient_summary: '3 个收件人',
        recipient_preview: 'ops@example.com、lead@example.com',
        from_address: 'sender@example.com',
        reply_to: 'reply@example.com',
        subject_prefix: '[OPS]',
        total_attempts: 12,
        delivery_rate: 91.25,
        dead_letter_count: 1,
        retry_count: 2,
        last_error: 'API timeout',
        last_attempt_at: '2026-04-01T12:00:00.000Z',
        updated_at: '2026-04-01T11:00:00.000Z',
        recent_deliveries: [
            { title: '退款成功', target_summary: 'ORDER-1' }
        ],
        recent_errors: [
            { message: 'API timeout', count: 2, last_seen_at: '2026-04-01T12:30:00.000Z' }
        ]
    }, {
        formatCount: (value) => `#${value}`,
        formatDateTime: (value) => `FMT:${value}`
    });

    assert.deepEqual(JSON.parse(JSON.stringify(cardState)), {
        tone: 'warning',
        label: '邮件',
        metaLine: '最小级别：warning · 配置来源：环境变量 · 3 个收件人 · 更新于 FMT:2026-04-01T11:00:00.000Z',
        statusBadges: [
            { label: '已启用', tone: 'warning' },
            { label: '待补充', tone: 'warning' }
        ],
        stats: [
            { value: '#12', label: '近窗投递' },
            { value: '91.3%', label: '送达率' },
            { value: '#1', label: '死信' },
            { value: '#2', label: '重试' }
        ],
        configDetails: [
            { label: '收件人', value: 'ops@example.com、lead@example.com' },
            { label: '发件地址', value: 'sender@example.com' },
            { label: 'Reply-To', value: 'reply@example.com' },
            { label: '最近类型', value: '退款成功 (ORDER-1)' },
            { label: '主题前缀', value: '[OPS]' }
        ],
        summaryText: '最近错误：API timeout',
        recentErrors: [
            { message: 'API timeout', meta: '#2 次 · FMT:2026-04-01T12:30:00.000Z' }
        ],
        recentErrorsEmptyText: '最近没有失败明细。'
    });

    const panelState = runtime.buildAdminWorkbenchOpsAlertHealthPanelState({
        status: 'ready',
        summary: {
            lookback_hours: 72,
            total_attempt_count: 18,
            delivered_count: 15,
            failed_count: 2,
            dead_letter_count: 1
        },
        channels: [{ key: 'telegram' }]
    }, {
        defaultHealthState: {
            status: 'idle',
            summary: {
                lookback_hours: 72,
                total_attempt_count: 0,
                delivered_count: 0,
                failed_count: 0,
                dead_letter_count: 0
            }
        },
        formatCount: (value) => `#${value}`
    });

    assert.deepEqual(JSON.parse(JSON.stringify(panelState)), {
        status: 'ready',
        metaIcon: 'fas fa-heart-pulse',
        metaText: '最近 #72 小时共记录 #18 次投递，送达 #15 次，失败 #2 次，死信 #1 项。',
        emptyMessage: '',
        shouldRenderCards: true
    });
});

test('shared admin workbench builds ops alert strategy control state', () => {
    const runtime = loadAdminWorkbenchRuntime();
    const controlState = runtime.buildAdminWorkbenchOpsAlertStrategyControlState({
        temporary_mute: {
            until: '2026-04-01T18:00:00.000Z',
            allow_critical: false
        },
        quiet_hours: {
            enabled: true,
            start_hour: 23,
            end_hour: 8,
            timezone: 'UTC',
            allow_critical: true
        },
        work_hours: {
            enabled: false,
            start_hour: 10,
            end_hour: 19,
            timezone: 'Asia/Shanghai'
        },
        mute_rules: {
            types: {
                customer_chat_message: {
                    until: '2026-04-02T02:00:00.000Z',
                    allow_critical: false
                }
            },
            modules: {
                payment_gateway: {
                    until: '2026-03-31T02:00:00.000Z',
                    allow_critical: true
                }
            }
        },
        routing: {
            customer_chat_message: {
                telegram: true,
                feishu: false,
                email: true
            },
            payment_gateway: {
                telegram: false,
                feishu: true,
                email: false
            }
        }
    }, {
        normalizeConfig: (value) => value,
        getDefaultConfig: () => ({
            temporary_mute: { until: '', allow_critical: true },
            quiet_hours: { enabled: false, start_hour: 22, end_hour: 8, timezone: 'Asia/Shanghai', allow_critical: true },
            work_hours: { enabled: false, start_hour: 9, end_hour: 18, timezone: 'Asia/Shanghai' },
            routing: {
                customer_chat_message: { telegram: true, feishu: true, email: true },
                payment_gateway: { telegram: true, feishu: true, email: true }
            }
        }),
        getTemporaryMuteState: () => ({
            active: true,
            expired: false,
            untilLabel: 'FMT:2026-04-01T18:00:00.000Z',
            allowCritical: false
        }),
        getMuteRuleDefinitions: (scope) => (
            scope === 'types'
                ? [{ key: 'customer_chat_message' }]
                : [{ key: 'payment_gateway' }]
        ),
        getMuteRuleState: (rule = {}) => {
            if (rule.until === '2026-04-02T02:00:00.000Z') {
                return {
                    active: true,
                    expired: false,
                    untilLabel: 'RULE:ACTIVE',
                    allowCritical: false
                };
            }
            return {
                active: false,
                expired: true,
                untilLabel: 'RULE:EXPIRED',
                allowCritical: true
            };
        },
        formatDateTimeLocalInputValue: (value) => `LOCAL:${value}`,
        formatHourRangePreview: (startHour, endHour, options = {}) => `H:${startHour}-${endHour} (${options.timezone || 'UTC'})`
    });

    assert.deepEqual(JSON.parse(JSON.stringify(controlState)), {
        temporaryMute: {
            untilValue: 'LOCAL:2026-04-01T18:00:00.000Z',
            allowCriticalActive: false,
            statusText: '当前已静默至 FMT:2026-04-01T18:00:00.000Z，所有级别暂停外发。',
            statusHidden: false,
            clearHidden: false
        },
        quietHours: {
            enabledActive: true,
            allowCriticalActive: true,
            allowCriticalDisabled: false,
            inputsDisabled: false,
            rangeHint: 'H:23-8 (UTC)'
        },
        workHours: {
            enabledActive: false,
            inputsDisabled: true,
            rangeHint: 'H:10-19 (Asia/Shanghai)'
        },
        muteRules: {
            types: {
                customer_chat_message: {
                    untilValue: 'LOCAL:2026-04-02T02:00:00.000Z',
                    allowCriticalActive: false,
                    statusText: 'RULE:ACTIVE 前静默，全部级别暂停。',
                    statusHidden: false,
                    clearHidden: false,
                    rowState: 'active'
                }
            },
            modules: {
                payment_gateway: {
                    untilValue: 'LOCAL:2026-03-31T02:00:00.000Z',
                    allowCriticalActive: true,
                    statusText: '已于 RULE:EXPIRED 到期，可清除旧时间。',
                    statusHidden: false,
                    clearHidden: false,
                    rowState: 'expired'
                }
            }
        },
        routingMatrix: {
            customer_chat_message: {
                telegram: true,
                feishu: false,
                email: true
            },
            payment_gateway: {
                telegram: false,
                feishu: true,
                email: false
            }
        }
    });
});

test('shared admin workbench normalizes ops alert settings payloads', () => {
    const runtime = loadAdminWorkbenchRuntime();
    const normalized = runtime.normalizeAdminWorkbenchOpsAlertSettingsPayload({
        config: { enabled: true },
        secrets: { telegram_bot_token: { configured: true } }
    }, {
        normalizeConfig: (config) => ({
            normalized: true,
            enabled: config?.enabled === true
        }),
        defaultSecrets: {
            telegram_bot_token: { configured: false },
            feishu_webhook_url: { configured: false }
        }
    });

    assert.deepEqual(JSON.parse(JSON.stringify(normalized)), {
        config: {
            normalized: true,
            enabled: true
        },
        secrets: {
            telegram_bot_token: { configured: true }
        }
    });
});

test('shared admin workbench stops when module access is denied', async () => {
    const runtime = loadAdminWorkbenchRuntime();
    const toasts = [];
    let shopInitCalled = false;

    runtime.showToast = (message, tone) => {
        toasts.push({ message, tone });
    };
    runtime.switchModule = () => false;
    runtime.ShopAdmin = {
        async init() {
            shopInitCalled = true;
        },
        switchTab() {},
        focusOrder() {}
    };

    const opened = await runtime.openAdminWorkbenchEntry('shop-risk-orders', {
        orderId: 'ORDER-1'
    });

    assert.equal(opened, false);
    assert.equal(shopInitCalled, false);
    assert.equal(toasts.some((entry) => String(entry.message || '').includes('已打开')), false);
    assert.equal(toasts.some((entry) => String(entry.message || '').includes('模块权限')), true);
});

test('shared admin workbench opens user modal after switching users module', async () => {
    const runtime = loadAdminWorkbenchRuntime();
    const toasts = [];
    let switchCalls = 0;
    const modalCalls = [];

    runtime.showToast = (message, tone) => {
        toasts.push({ message, tone });
    };
    runtime.switchModule = () => {
        switchCalls += 1;
        return true;
    };
    runtime.openUserModal = async (userId, options = {}) => {
        modalCalls.push({ userId, options });
        return true;
    };

    const opened = await runtime.openAdminWorkbenchEntry('shop-risk-users', {
        userId: 'user-123',
        email: 'ops@example.com',
        paymentOrderId: 'pay-456',
        tab: 'payments'
    });

    assert.equal(opened, true);
    assert.equal(switchCalls, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(modalCalls)), [{
        userId: 'user-123',
        options: {
            defaultTab: 'payments',
            paymentOrderId: 'pay-456',
            fallbackEmail: 'ops@example.com',
            silentOnNotFound: true
        }
    }]);
    assert.equal(toasts.some((entry) => String(entry.message || '').includes('已打开用户详情')), true);
});

test('shared admin workbench exposes workspace access checks for modal-first user actions', () => {
    const runtime = loadAdminWorkbenchRuntime();

    assert.equal(runtime.canOpenAdminWorkbenchWorkspace('shop-risk-orders', {}), true);
    assert.equal(runtime.canOpenAdminWorkbenchWorkspace('shop-risk-users', {}), true);

    runtime.hasModulePermission = () => false;
    assert.equal(runtime.canOpenAdminWorkbenchWorkspace('shop-risk-orders', {}), false);
    assert.equal(runtime.canOpenAdminWorkbenchWorkspace('shop-risk-users', {
        userId: 'user-123'
    }), false);
});
