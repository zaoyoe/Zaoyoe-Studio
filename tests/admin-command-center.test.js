const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const commandCenterPath = path.resolve(__dirname, '../js/admin-command-center.js');
const commandCenterCssPath = path.resolve(__dirname, '../css/admin-command-center.css');
const adminConfigPath = path.resolve(__dirname, '../admin-config.js');

function createElement(tagName = 'div', id = '') {
    const element = {
        tagName: tagName.toUpperCase(),
        id,
        className: '',
        dataset: {},
        attributes: {},
        innerHTML: '',
        parentNode: null,
        listeners: {},
        classList: {
            values: new Set(),
            toggle(name, force) {
                if (force) {
                    this.values.add(name);
                } else {
                    this.values.delete(name);
                }
            }
        },
        setAttribute(name, value) {
            this.attributes[name] = String(value);
        },
        addEventListener(name, handler) {
            this.listeners[name] = handler;
        },
        insertAdjacentElement(position, child) {
            child.parentNode = this.parentNode || this;
            if (child.id) {
                this.ownerDocument.elements[child.id] = child;
            }
        },
        querySelector() {
            return null;
        }
    };
    return element;
}

function loadCommandCenterRuntime(options = {}) {
    const script = fs.readFileSync(commandCenterPath, 'utf8');
    const listeners = {};
    const elements = {};
    const now = Date.now();
    const primeCalls = [];
    const scheduledTasks = [];
    const clearedTasks = [];
    const timingMarks = [];
    const timingMeasures = [];
    const commandSummaries = {
        notifications: {
            ready: true,
            status: 'ready',
            unreadMessages: 5,
            pendingReply: 2,
            systemAlerts: 3,
            unreadSystemAlerts: 3,
            actionableCount: 5,
            recentItems: [
                {
                    label: 'Alice',
                    copy: '久未回复 · 用户催问充值到账',
                    timestamp: now - 60 * 1000,
                    tone: 'alert',
                    moduleId: 'chat',
                    stateKey: 'notifications-session-session_alice',
                    feedbackLabel: 'Alice',
                    intent: '打开 Alice 会话。',
                    context: {
                        payload: {
                            sessionId: 'session_alice'
                        }
                    }
                },
                {
                    label: '系统告警',
                    copy: '验证码会话出现超时积压',
                    timestamp: now - 3 * 60 * 1000,
                    tone: 'warn',
                    moduleId: 'ops-workspace',
                    stateKey: 'notifications-alert-verify-backlog',
                    feedbackLabel: '查看验证面板',
                    intent: '打开这条告警对应的查看验证面板工作位。',
                    context: {
                        alertType: 'verify_queue_backlog',
                        referenceLabel: '验证队列',
                        referenceValue: '验证码会话出现超时积压'
                    },
                    options: {
                        workspaceKey: 'verify-monitor'
                    }
                }
            ]
        },
        payments: {
            ready: true,
            status: 'ready',
            retryCount: 1,
            reviewOrders: 1,
            failedOrders: 0,
            paidRate: 98.7,
            actionableCount: 2,
            recentItems: [
                {
                    label: '待审核订单',
                    copy: 'Google One 月卡 · ZPAY-1029 · 待处理',
                    timestamp: now - 2 * 60 * 1000,
                    tone: 'warn',
                    moduleId: 'payments',
                    stateKey: 'payments-order-pay_1029',
                    feedbackLabel: 'ZPAY-1029',
                    intent: '打开支付订单 ZPAY-1029。',
                    context: {
                        focus: {
                            paymentOrderId: 'pay_1029'
                        },
                        payload: {
                            defaultTab: 'ops',
                            tab: 'ops'
                        }
                    },
                    options: {
                        defaultTab: 'ops',
                        tab: 'ops'
                    }
                },
                {
                    label: '回调队列',
                    copy: '回调任务等待重试投递',
                    timestamp: now - 5 * 60 * 1000,
                    tone: 'warn',
                    moduleId: 'payments',
                    stateKey: 'payments-ops-queue',
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
                }
            ]
        },
        inventory: {
            ready: true,
            status: 'ready',
            lowStockCount: 2,
            soldOutCount: 0,
            deliveryRiskProductCount: 1,
            purchaseConversionRate: 12.4,
            actionableCount: 3,
            recentItems: [
                {
                    label: '低库存',
                    copy: 'Google One 月卡 · 库存 4',
                    tone: 'warn',
                    moduleId: 'shop',
                    stateKey: 'inventory-low-stock-google-one',
                    feedbackLabel: '库存导入',
                    intent: '打开商城系统导入，继续处理 Google One 月卡 的补货。',
                    context: {
                        action: 'open-import',
                        payload: {
                            workspace: 'import',
                            defaultTab: 'import',
                            tab: 'import'
                        }
                    },
                    options: {
                        defaultTab: 'import',
                        tab: 'import'
                    }
                },
                {
                    label: '履约风险',
                    copy: 'iTunes 美区卡 · 风险 1 单',
                    tone: 'warn',
                    moduleId: 'commerce-center',
                    stateKey: 'inventory-delivery-risk-itunes',
                    feedbackLabel: 'iTunes 美区卡',
                    intent: '打开 iTunes 美区卡 的履约风险拆解。',
                    context: {
                        payload: {
                            view: 'product',
                            tab: 'product',
                            focusTargetId: 'productRiskBreakdownSection',
                            productId: 'product_itunes',
                            productName: 'iTunes 美区卡',
                            detailFocus: 'delivery-risk'
                        }
                    },
                    options: {
                        viewName: 'product'
                    }
                }
            ]
        },
        ai: {
            ready: true,
            status: 'warning',
            configured: false,
            service: 'codex',
            serviceLabel: 'Codex Relay',
            model: 'gpt-5.4',
            maxOutputTokens: 120,
            lastResponseOk: null,
            actionableCount: 1,
            lastMessage: '请先在后台 API 配置中填写 Codex Relay 的 Base URL、Model、接口格式，并录入 API Key',
            recentItems: [
                {
                    label: 'AI 配置',
                    copy: 'Codex Relay 尚未录入 API Key',
                    tone: 'warn',
                    moduleId: 'settings',
                    stateKey: 'budget-recent-config',
                    feedbackLabel: 'AI 配置',
                    intent: '打开通用设置中的 Codex Relay 配置入口。',
                    context: {
                        action: 'general',
                        payload: {
                            defaultTab: 'general',
                            focusTargetId: 'codexConfigPanel'
                        }
                    },
                    options: {
                        viewName: 'general',
                        settingsView: 'general',
                        focusTargetId: 'codexConfigPanel'
                    }
                }
            ]
        },
        security: {
            ready: true,
            status: 'ready',
            accessCount: 200,
            anomalyCount: 0,
            configChangeCount: 2,
            actionableCount: 0,
            recentItems: [
                {
                    label: '配置变更',
                    copy: '支付通道切换到了 mock 模式',
                    timestamp: now - 4 * 60 * 1000,
                    tone: 'alert',
                    moduleId: 'settings',
                    stateKey: 'security-config-mock-switch',
                    feedbackLabel: '配置审计',
                    intent: '打开安全审计中的配置变更记录。',
                    context: {
                        action: 'security',
                        payload: {
                            defaultTab: 'security',
                            workspace: 'admin-audit-monitor',
                            focusTargetId: 'adminAuditMonitorConfigList'
                        }
                    },
                    options: {
                        viewName: 'security',
                        settingsView: 'security',
                        workspace: 'admin-audit-monitor'
                    }
                },
                {
                    label: '管理员访问',
                    copy: 'admin@zaoyoe.com · 10.0.0.8 · 凭证已签发',
                    timestamp: now - 8 * 60 * 1000,
                    tone: 'ok',
                    moduleId: 'settings',
                    stateKey: 'security-access-admin',
                    feedbackLabel: '访问审计',
                    intent: '打开安全审计中的管理员访问记录。',
                    context: {
                        action: 'security',
                        payload: {
                            defaultTab: 'security',
                            workspace: 'admin-audit-monitor',
                            focusTargetId: 'adminAuditMonitorRecentAccess'
                        }
                    },
                    options: {
                        viewName: 'security',
                        settingsView: 'security',
                        workspace: 'admin-audit-monitor'
                    }
                }
            ]
        }
    };
    const header = createElement('header', 'studioHeader');
    const parent = createElement('main', 'adminMain');
    header.parentNode = parent;
    elements.studioHeader = header;

    const document = {
        readyState: 'complete',
        elements,
        createElement(tagName) {
            const element = createElement(tagName);
            element.ownerDocument = document;
            return element;
        },
        getElementById(id) {
            return elements[id] || null;
        },
        querySelector(selector) {
            if (selector === '.studio-header') {
                header.ownerDocument = document;
                return header;
            }
            if (selector === '.module-container.active') {
                return { id: 'module-gallery' };
            }
            if (selector === '.sidebar-item.active[data-module]') {
                return { dataset: { module: 'gallery' } };
            }
            return null;
        },
        addEventListener() {}
    };

    const window = {
        document,
        localStorage: {
            getItem() {
                return '0';
            },
            setItem() {}
        },
        AdminSiteFilter: {
            getSiteFilter() {
                return 'cn';
            }
        },
        AdminShell: {
            getActiveModuleId() {
                return 'gallery';
            }
        },
        getAdminChatCommandCenterSummary() {
            return { ...commandSummaries.notifications };
        },
        async primeAdminChatCommandCenterSummary(options = {}) {
            primeCalls.push({ key: 'notifications', force: options.force === true });
            return { ...commandSummaries.notifications };
        },
        AdminPayments: {
            getCommandCenterSummary() {
                return { ...commandSummaries.payments };
            },
            async primeCommandCenterSummary(options = {}) {
                primeCalls.push({ key: 'payments', force: options.force === true });
                return { ...commandSummaries.payments };
            }
        },
        getAnalyticsCommandCenterInventorySummary() {
            return { ...commandSummaries.inventory };
        },
        async primeAnalyticsCommandCenterInventorySummary(options = {}) {
            primeCalls.push({ key: 'inventory', force: options.force === true });
            return { ...commandSummaries.inventory };
        },
        AdminAI: {
            getPreferredService() {
                return commandSummaries.ai.service || 'codex';
            },
            getServiceLabel(service) {
                return service === 'codex' ? 'Codex Relay' : service;
            },
            getCommandCenterSummary() {
                return { ...commandSummaries.ai };
            },
            async primeCommandCenterSummary(options = {}) {
                primeCalls.push({ key: 'ai', force: options.force === true });
                return { ...commandSummaries.ai };
            }
        },
        getAdminAuditMonitorCommandCenterSummary() {
            return { ...commandSummaries.security };
        },
        async primeAdminAuditMonitorCommandCenterSummary(options = {}) {
            primeCalls.push({ key: 'security', force: options.force === true });
            return { ...commandSummaries.security };
        },
        AdminStudioTiming: options.captureTiming ? {
            mark(name, detail = {}) {
                timingMarks.push({ name, detail: { ...detail } });
            },
            markOnce(name, detail = {}) {
                if (timingMarks.some((entry) => entry.name === name)) {
                    return null;
                }
                timingMarks.push({ name, detail: { ...detail } });
                return null;
            },
            measure(name, startName, endName, detail = {}) {
                timingMeasures.push({ name, startName, endName, detail: { ...detail } });
            }
        } : null,
        addEventListener(name, handler) {
            listeners[name] = handler;
        },
        dispatchEvent(event) {
            const handler = listeners[event?.type];
            if (typeof handler === 'function') {
                handler(event);
            }
        }
    };
    if (options.captureTimers) {
        window.setTimeout = (callback, delay = 0) => {
            const id = scheduledTasks.length + 1;
            scheduledTasks.push({ id, callback, delay });
            return id;
        };
        window.clearTimeout = (id) => {
            clearedTasks.push(id);
        };
    }
    const context = {
        document,
        window,
        CustomEvent: function CustomEvent(type, init) {
            this.type = type;
            this.detail = init?.detail;
        }
    };
    window.window = window;

    vm.runInNewContext(script, context);

    return {
        window,
        listeners,
        elements,
        commandSummaries,
        clearedTasks,
        primeCalls,
        scheduledTasks,
        timingMarks,
        timingMeasures
    };
}

test('AdminCommandCenter renders actionable dock and task-oriented pulse panels', () => {
    const { window, listeners, elements, commandSummaries } = loadCommandCenterRuntime();

    assert.equal(window.AdminCommandCenter.version, '20260428_ADMIN_PULSE_DOCK_SWITCH_STEADY_1');
    assert.match(elements.adminCommandCenter.innerHTML, /运营待处理/);
    assert.match(elements.adminCommandCenter.innerHTML, /待办总览/);
    assert.match(elements.adminCommandCenter.innerHTML, /11 项待处理/);
    assert.match(elements.adminCommandCenter.innerHTML, /站内通知/);
    assert.match(elements.adminCommandCenter.innerHTML, /支付回调/);
    assert.match(elements.adminCommandCenter.innerHTML, /订单库存/);
    assert.match(elements.adminCommandCenter.innerHTML, /AI 配置/);
    assert.doesNotMatch(elements.adminCommandCenter.innerHTML, /data-admin-command-pulse-proxy/);

    window.AdminCommandCenter.setSecurityStatus('管理员权限已确认');
    assert.doesNotMatch(elements.adminCommandCenter.innerHTML, /data-admin-command-pulse="security"[\s\S]*admin-command-center__badge/);

    listeners['admin-ai-budget']({
        detail: {
            service: 'codex',
            budget: {
                tier: 'lean',
                estimatedInputTokens: 12,
                maxOutputTokens: 120,
                truncated: false
            }
        }
    });

    commandSummaries.ai = {
        ...commandSummaries.ai,
        status: 'ready',
        configured: true,
        estimatedInputTokens: 12,
        maxOutputTokens: 120,
        actionableCount: 0,
        lastMessage: ''
    };
    listeners['admin-ai-command-summary-updated']({
        detail: {
            ...commandSummaries.ai
        }
    });

    assert.match(elements.adminCommandCenter.innerHTML, /AI 配置/);
    assert.match(elements.adminCommandCenter.innerHTML, /已配置/);

    listeners['admin-shell-context']({
        detail: {
            context: {
                source: 'comments',
                destination: 'growth-center',
                entity: 'prompt',
                action: 'open-prompt-analytics',
                focus: {
                    promptId: 'prompt_1234567890abcdef'
                },
                payload: {
                    sectionId: 'contentCommerceDetailSection'
                }
            },
            delivery: {
                handled: true,
                status: 'delivered',
                at: Date.now()
            }
        }
    });

    assert.equal(window.AdminCommandCenter.getState().contextTrail[0].source, 'comments');
    assert.equal(window.AdminCommandCenter.getState().contextTrail[0].destination, 'growth-center');

    listeners['admin-feedback-signal']({
        detail: {
            source: 'toast',
            state: 'saved',
            message: '工单状态已同步',
            module: 'tickets',
            timestamp: Date.now()
        }
    });

    assert.equal(window.AdminCommandCenter.getState().feedbackSignals[0].message, '工单状态已同步');

    listeners['admin-feedback-signal']({
        detail: {
            source: 'payments-batch',
            state: 'partial',
            message: '已归档 3 条，另有 1 条失败',
            module: 'payments',
            timestamp: Date.now()
        }
    });

    assert.equal(window.AdminCommandCenter.getState().feedbackSignals[0].sourceLabel, '支付批量');
    assert.equal(window.AdminCommandCenter.getState().feedbackSignals[0].state, 'partial');

    listeners['admin-feedback-signal']({
        detail: {
            source: 'comments-batch',
            state: 'saved',
            message: '已批量设为已解决（4 条）',
            module: 'comments',
            timestamp: Date.now()
        }
    });

    assert.equal(window.AdminCommandCenter.getState().feedbackSignals[0].sourceLabel, '评论批量');

    listeners['admin-feedback-signal']({
        detail: {
            source: 'comments-governance',
            state: 'saved',
            message: '评论已置顶',
            module: 'comments',
            timestamp: Date.now()
        }
    });

    assert.equal(window.AdminCommandCenter.getState().feedbackSignals[0].sourceLabel, '评论治理');
});

test('AdminCommandCenter uses live summaries for notifications, payments, inventory, AI, and security metrics', () => {
    const { elements } = loadCommandCenterRuntime();

    assert.match(elements.adminCommandCenter.innerHTML, /11 项待处理/);
    assert.match(elements.adminCommandCenter.innerHTML, /站内通知[\s\S]*5项/);
    assert.match(elements.adminCommandCenter.innerHTML, /支付回调[\s\S]*2项/);
    assert.match(elements.adminCommandCenter.innerHTML, /订单库存[\s\S]*3项/);
    assert.match(elements.adminCommandCenter.innerHTML, /AI 配置[\s\S]*待配置/);
    assert.match(elements.adminCommandCenter.innerHTML, /用户催问充值到账|验证码会话出现超时积压|支付通道切换到了 mock 模式/);
    assert.doesNotMatch(elements.adminCommandCenter.innerHTML, /用户消息 2 人待回复/);

    elements.adminCommandCenter.listeners.click({
        target: {
            closest(selector) {
                if (selector === '[data-admin-command-pulse]') {
                    return {
                        dataset: {
                            adminCommandPulse: 'notifications'
                        }
                    };
                }
                return null;
            }
        }
    });

    assert.match(elements.adminCommandCenter.innerHTML, /未读消息[\s\S]*5条/);
    assert.match(elements.adminCommandCenter.innerHTML, /用户待回[\s\S]*2人/);
    assert.match(elements.adminCommandCenter.innerHTML, /未读告警[\s\S]*3条/);
    assert.match(elements.adminCommandCenter.innerHTML, /活跃告警[\s\S]*3条/);
    assert.match(elements.adminCommandCenter.innerHTML, /标记已读后数字会下降/);
    assert.doesNotMatch(elements.adminCommandCenter.innerHTML, /全部已读/);
    assert.match(elements.adminCommandCenter.innerHTML, /Alice[\s\S]*用户催问充值到账/);
    assert.doesNotMatch(elements.adminCommandCenter.innerHTML, /用户询问充值到账时间/);

    elements.adminCommandCenter.listeners.click({
        target: {
            closest(selector) {
                if (selector === '[data-admin-command-pulse]') {
                    return {
                        dataset: {
                            adminCommandPulse: 'payments'
                        }
                    };
                }
                return null;
            }
        }
    });

    assert.match(elements.adminCommandCenter.innerHTML, /待重试[\s\S]*1单/);
    assert.match(elements.adminCommandCenter.innerHTML, /待审核[\s\S]*1单/);
    assert.match(elements.adminCommandCenter.innerHTML, /失败订单[\s\S]*0单/);
    assert.doesNotMatch(elements.adminCommandCenter.innerHTML, /平均延迟/);
    assert.match(elements.adminCommandCenter.innerHTML, /Google One 月卡[\s\S]*ZPAY-1029/);
    assert.doesNotMatch(elements.adminCommandCenter.innerHTML, /订单 #A1029 回调等待重试/);

    elements.adminCommandCenter.listeners.click({
        target: {
            closest(selector) {
                if (selector === '[data-admin-command-pulse]') {
                    return {
                        dataset: {
                            adminCommandPulse: 'inventory'
                        }
                    };
                }
                return null;
            }
        }
    });

    assert.match(elements.adminCommandCenter.innerHTML, /低库存[\s\S]*2个/);
    assert.match(elements.adminCommandCenter.innerHTML, /售罄商品[\s\S]*0个/);
    assert.match(elements.adminCommandCenter.innerHTML, /履约风险[\s\S]*1项/);
    assert.doesNotMatch(elements.adminCommandCenter.innerHTML, /异常订单[\s\S]*1单/);

    elements.adminCommandCenter.listeners.click({
        target: {
            closest(selector) {
                if (selector === '[data-admin-command-pulse]') {
                    return {
                        dataset: {
                            adminCommandPulse: 'budget'
                        }
                    };
                }
                return null;
            }
        }
    });

    assert.match(elements.adminCommandCenter.innerHTML, /AI 配置与运行态/);
    assert.match(elements.adminCommandCenter.innerHTML, /当前服务[\s\S]*未配置/);
    assert.match(elements.adminCommandCenter.innerHTML, /当前模型[\s\S]*未配置/);
    assert.match(elements.adminCommandCenter.innerHTML, /输出上限[\s\S]*120 token/);
    assert.doesNotMatch(elements.adminCommandCenter.innerHTML, /\$12\.40/);
    assert.match(elements.adminCommandCenter.innerHTML, /Codex Relay 尚未录入 API Key/);

    elements.adminCommandCenter.listeners.click({
        target: {
            closest(selector) {
                if (selector === '[data-admin-command-pulse]') {
                    return {
                        dataset: {
                            adminCommandPulse: 'security'
                        }
                    };
                }
                return null;
            }
        }
    });

    assert.match(elements.adminCommandCenter.innerHTML, /后台访问[\s\S]*200次/);
    assert.match(elements.adminCommandCenter.innerHTML, /异常信号[\s\S]*0条/);
    assert.match(elements.adminCommandCenter.innerHTML, /配置审计[\s\S]*2条/);
    assert.match(elements.adminCommandCenter.innerHTML, /支付通道切换到了 mock 模式/);
    assert.doesNotMatch(elements.adminCommandCenter.innerHTML, /2 位管理员 · 5 个 IP/);
});

test('AdminCommandCenter stages heavy summary primes after the first dock render', () => {
    const { listeners, primeCalls, scheduledTasks, clearedTasks } = loadCommandCenterRuntime({ captureTimers: true });

    assert.deepEqual(
        primeCalls.map((call) => `${call.key}:${call.force}`),
        ['notifications:false', 'inventory:false']
    );
    assert.deepEqual(
        scheduledTasks.map((task) => task.delay),
        [650, 1300, 2100]
    );

    listeners['admin-site-changed']({
        detail: {
            site: 'intl'
        }
    });

    assert.deepEqual(clearedTasks, [1, 2, 3]);
    assert.deepEqual(
        primeCalls.map((call) => `${call.key}:${call.force}`),
        ['notifications:false', 'inventory:false', 'notifications:true', 'inventory:true']
    );
    assert.deepEqual(
        scheduledTasks.slice(3).map((task) => task.delay),
        [650, 1300, 2100]
    );

    scheduledTasks.slice(0, 3).forEach((task) => task.callback());
    assert.deepEqual(
        primeCalls.map((call) => `${call.key}:${call.force}`),
        ['notifications:false', 'inventory:false', 'notifications:true', 'inventory:true']
    );

    scheduledTasks.slice(3).forEach((task) => task.callback());
    assert.deepEqual(
        primeCalls.map((call) => `${call.key}:${call.force}`),
        [
            'notifications:false',
            'inventory:false',
            'notifications:true',
            'inventory:true',
            'payments:true',
            'ai:true',
            'security:true'
        ]
    );
});

test('AdminCommandCenter emits timing marks for first render and staged summary primes', async () => {
    const { scheduledTasks, timingMarks, timingMeasures } = loadCommandCenterRuntime({
        captureTimers: true,
        captureTiming: true
    });

    for (let index = 0; index < 5; index += 1) {
        await Promise.resolve();
    }
    assert.equal(
        timingMarks.some((entry) => entry.name === 'command-center:first-render'),
        true,
        'command center should mark the first dock render'
    );
    assert.equal(
        timingMarks.some((entry) => entry.name === 'command-center:prime:notifications:start'),
        true,
        'command center should mark notification prime start'
    );
    assert.equal(
        timingMarks.some((entry) => entry.name === 'command-center:prime:inventory:end'),
        true,
        'command center should mark inventory prime completion'
    );

    scheduledTasks.forEach((task) => task.callback());
    for (let index = 0; index < 5; index += 1) {
        await Promise.resolve();
    }

    for (const key of ['payments', 'ai', 'security']) {
        assert.equal(
            timingMarks.some((entry) => entry.name === `command-center:prime:${key}:start`),
            true,
            `command center should mark ${key} prime start`
        );
        assert.equal(
            timingMarks.some((entry) => entry.name === `command-center:prime:${key}:end`),
            true,
            `command center should mark ${key} prime completion`
        );
        assert.equal(
            timingMeasures.some((entry) => entry.name === `command-center:prime:${key}`),
            true,
            `command center should measure ${key} prime duration`
        );
    }
});

test('AdminCommandCenter keeps the AI dock badge hidden until the AI summary is ready', () => {
    const { elements, listeners } = loadCommandCenterRuntime();

    listeners['admin-ai-command-summary-updated']({
        detail: {
            ready: false,
            status: 'idle',
            configured: false,
            service: 'codex',
            serviceLabel: 'Codex Relay',
            actionableCount: 1,
            lastMessage: '',
            recentItems: []
        }
    });

    assert.match(elements.adminCommandCenter.innerHTML, /10 项待处理/);
    assert.match(elements.adminCommandCenter.innerHTML, /AI 配置[\s\S]*同步中/);
    assert.doesNotMatch(
        elements.adminCommandCenter.innerHTML,
        /data-admin-command-pulse="budget"[\s\S]*?<span class="admin-command-center__badge/
    );

    listeners['admin-ai-command-summary-updated']({
        detail: {
            ready: true,
            status: 'warning',
            configured: false,
            service: 'codex',
            serviceLabel: 'Codex Relay',
            actionableCount: 1,
            lastMessage: '请先完成 AI 配置',
            recentItems: []
        }
    });

    assert.match(elements.adminCommandCenter.innerHTML, /11 项待处理/);
    assert.match(
        elements.adminCommandCenter.innerHTML,
        /data-admin-command-pulse="budget"[\s\S]*?<span class="admin-command-center__badge[^"]*">1<\/span>/
    );
});

test('AdminCommandCenter keeps the security dock badge cleared when only anomaly signals remain', () => {
    const { elements, listeners } = loadCommandCenterRuntime();

    listeners['admin-audit-command-summary-updated']({
        detail: {
            ready: true,
            status: 'ready',
            accessCount: 200,
            anomalyCount: 3,
            configChangeCount: 2,
            activeProblemCount: 0,
            recentItems: [{
                label: '异常登录信号',
                copy: 'admin@example.com · 198.51.100.21 · 最近窗口出现 2 个登录 IP',
                timestamp: Date.now() - 2 * 60 * 1000,
                tone: 'warn',
                moduleId: 'settings',
                stateKey: 'security-anomaly-admin-user-1',
                feedbackLabel: '异常登录信号',
                intent: '打开安全审计中的异常登录信号列表。',
                context: {
                    action: 'security',
                    payload: {
                        defaultTab: 'security',
                        workspace: 'admin-audit-monitor',
                        focusTargetId: 'adminAuditMonitorAnomalyList'
                    }
                },
                options: {
                    viewName: 'security',
                    settingsView: 'security',
                    workspace: 'admin-audit-monitor'
                }
            }]
        }
    });

    assert.match(elements.adminCommandCenter.innerHTML, /11 项待处理/);
    assert.match(elements.adminCommandCenter.innerHTML, /aria-label="安全审计 3 条信号待核对"/);
    assert.doesNotMatch(
        elements.adminCommandCenter.innerHTML,
        /data-admin-command-pulse="security"[\s\S]*?<span class="admin-command-center__badge/
    );

    elements.adminCommandCenter.listeners.click({
        target: {
            closest(selector) {
                if (selector === '[data-admin-command-pulse]') {
                    return {
                        dataset: {
                            adminCommandPulse: 'security'
                        }
                    };
                }
                return null;
            }
        }
    });

    assert.match(elements.adminCommandCenter.innerHTML, /3 条信号待核对/);
    assert.match(elements.adminCommandCenter.innerHTML, /需核对异常信号/);
    assert.match(elements.adminCommandCenter.innerHTML, /异常信号[\s\S]*3条/);
    assert.match(elements.adminCommandCenter.innerHTML, /Dock 只统计未关闭安全告警/);
});

test('admin audit command center summary only counts unresolved security alerts as actionable', () => {
    const source = fs.readFileSync(adminConfigPath, 'utf8');

    assert.match(source, /activeProblemCount,\s*actionableCount:\s*activeProblemCount,/);
    assert.doesNotMatch(source, /actionableCount:\s*activeProblemCount\s*>\s*0\s*\?\s*activeProblemCount\s*:\s*anomalyCount/);
});

test('AdminCommandCenter source keeps dock engagement and panel launch phases wired in', () => {
    const source = fs.readFileSync(commandCenterPath, 'utf8');

    assert.match(source, /panelPhase:\s*'closed'/);
    assert.match(source, /openPanel\(/);
    assert.match(source, /closePanel\(/);
    assert.match(source, /syncPanelPhaseDom\(\);/);
    assert.match(source, /is-engaged/);
    assert.match(source, /state\.panelPhase = 'opening'/);
    assert.match(source, /state\.panelPhase = 'closing'/);
});

test('AdminCommandCenter switches dock pulses without replaying the open animation', () => {
    const { elements } = loadCommandCenterRuntime();

    elements.adminCommandCenter.listeners.click({
        target: {
            closest(selector) {
                if (selector === '[data-admin-command-pulse]') {
                    return {
                        dataset: {
                            adminCommandPulse: 'notifications'
                        }
                    };
                }
                return null;
            }
        }
    });

    assert.match(elements.adminCommandCenter.innerHTML, /admin-command-center__panel is-opening/);

    elements.adminCommandCenter.listeners.click({
        target: {
            closest(selector) {
                if (selector === '[data-admin-command-pulse]') {
                    return {
                        dataset: {
                            adminCommandPulse: 'budget'
                        }
                    };
                }
                return null;
            }
        }
    });

    assert.match(elements.adminCommandCenter.innerHTML, /admin-command-center__panel is-open/);
    assert.doesNotMatch(elements.adminCommandCenter.innerHTML, /admin-command-center__panel is-opening/);
    assert.equal(elements.adminCommandCenter.innerHTML.includes('AI 配置与运行态'), true);
});

test('AdminCommandCenter CSS keeps clicked dock icons highlighted without extra lift', () => {
    const source = fs.readFileSync(commandCenterCssPath, 'utf8');

    assert.match(source, /admin-command-center__dock-btn\.is-engaged[\s\S]*?z-index:\s*2/);
    assert.match(source, /admin-command-center__dock-btn\.is-engaged \.admin-command-center__dock-icon[\s\S]*?--admin-command-dock-border/);
    assert.doesNotMatch(source, /admin-command-dock-engage-(rise|scale)/);
});

test('AdminCommandCenter CSS lets the panel body own vertical scrolling in narrow viewports', () => {
    const source = fs.readFileSync(commandCenterCssPath, 'utf8');

    assert.match(
        source,
        /\.admin-command-center__panel \{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column;[\s\S]*?min-height:\s*0;/,
        'panel should be a column flex shell so the body can use the remaining height'
    );
    assert.match(
        source,
        /\.admin-command-center__panel-body \{[\s\S]*?flex:\s*1 1 auto;[\s\S]*?min-height:\s*0;[\s\S]*?max-height:\s*none;[\s\S]*?overflow-y:\s*auto;/,
        'panel body should scroll within the available panel height instead of using a fixed viewport subtraction'
    );
    assert.match(source, /scroll-padding-bottom:\s*20px;/);
    assert.doesNotMatch(source, /\.admin-command-center__panel-body \{[\s\S]*?max-height:\s*calc\(100vh - 224px\)/);
});

test('AdminCommandCenter CSS hides the dock on mobile viewports', () => {
    const source = fs.readFileSync(commandCenterCssPath, 'utf8');

    assert.match(
        source,
        /20260428_ADMIN_PULSE_DOCK_MOBILE_HIDDEN_1[\s\S]*?@media \(max-width: 768px\) \{[\s\S]*?\.admin-command-center \{[\s\S]*?display:\s*none;/,
        'mobile admin studio should not render the floating command dock'
    );
});

test('AdminCommandCenter quick settings action falls back to the shared settings helper when shell routing is unavailable', async () => {
    const { window, elements } = loadCommandCenterRuntime();
    const helperCalls = [];

    window.switchModule = () => {
        throw new Error('legacy switchModule fallback should not run for settings quick action');
    };
    window.openAdminSettingsShellContext = async (context = {}, options = {}) => {
        helperCalls.push({ context, options });
        return true;
    };

    elements.adminCommandCenter.listeners.click({
        target: {
            closest(selector) {
                if (selector === '[data-admin-command-module]') {
                    return {
                        dataset: {
                            adminCommandModule: 'settings'
                        }
                    };
                }
                return null;
            }
        }
    });

    await Promise.resolve();
    await Promise.resolve();

    assert.deepEqual(JSON.parse(JSON.stringify(helperCalls)), [{
        context: {
            source: 'gallery',
            destination: 'settings',
            reason: 'command-center',
            action: 'security',
            payload: {
                defaultTab: 'security'
            }
        },
        options: {
            viewName: 'security',
            settingsView: 'security'
        }
    }]);
});

test('AdminCommandCenter quick ops action falls back to the shared ops alerts helper after shell denial', async () => {
    const { window, elements } = loadCommandCenterRuntime();
    const helperCalls = [];

    window.AdminShell.openContext = async () => false;
    window.switchModule = () => {
        throw new Error('legacy switchModule fallback should not run for ops quick action');
    };
    window.openAdminOpsAlertsShellContext = async (context = {}, options = {}) => {
        helperCalls.push({ context, options });
        return true;
    };

    elements.adminCommandCenter.listeners.click({
        target: {
            closest(selector) {
                if (selector === '[data-admin-command-module]') {
                    return {
                        dataset: {
                            adminCommandModule: 'ops-alerts'
                        }
                    };
                }
                return null;
            }
        }
    });

    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(JSON.parse(JSON.stringify(helperCalls)), [{
        context: {
            source: 'gallery',
            destination: 'ops-alerts',
            reason: 'command-center',
            payload: {
                view: 'overview'
            }
        },
        options: {
            viewName: 'overview'
        }
    }]);
});

test('AdminCommandCenter quick commerce action activates the target module before shared helper fallback', async () => {
    const { window, elements } = loadCommandCenterRuntime();
    const events = [];
    const feedbackSignals = [];

    window.AdminShell.openContext = async () => false;
    window.AdminShell.activateModule = (moduleId, options = {}) => {
        events.push({ type: 'activate', moduleId, options });
        return true;
    };
    window.switchModule = () => {
        throw new Error('legacy switchModule fallback should not run for commerce quick helper fallback');
    };
    window.openAdminGrowthCenterShellContext = async (context = {}, options = {}) => {
        events.push({ type: 'helper', context, options });
        return true;
    };
    window.dispatchEvent = (event) => {
        if (event?.type === 'admin-feedback-signal') {
            feedbackSignals.push(event.detail);
        }
    };

    elements.adminCommandCenter.listeners.click({
        target: {
            closest(selector) {
                if (selector === '[data-admin-command-pulse]') {
                    return {
                        dataset: {
                            adminCommandPulse: 'inventory'
                        }
                    };
                }
                return null;
            }
        }
    });

    elements.adminCommandCenter.listeners.click({
        target: {
            closest(selector) {
                if (selector === '[data-admin-command-module]') {
                    return {
                        dataset: {
                            adminCommandModule: 'commerce-center'
                        }
                    };
                }
                return null;
            }
        }
    });

    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(events.map((event) => event.type), ['activate', 'helper']);
    assert.equal(events[0].moduleId, 'commerce-center');
    assert.deepEqual(JSON.parse(JSON.stringify(events[0].options)), {
        context: {
            source: 'gallery',
            destination: 'commerce-center',
            reason: 'command-center'
        },
        deferContext: true,
        reason: 'command-center-helper-fallback'
    });
    assert.deepEqual(JSON.parse(JSON.stringify(events[1])), {
        type: 'helper',
        context: {
            source: 'gallery',
            destination: 'commerce-center',
            reason: 'command-center',
            payload: {
                view: 'product'
            }
        },
        options: {
            viewName: 'product'
        }
    });
    assert.deepEqual(
        feedbackSignals.map((signal) => ({
            source: signal.source,
            state: signal.state,
            module: signal.module,
            message: signal.message
        })),
        [
            {
                source: 'command-center',
                state: 'loading',
                module: 'commerce-center',
                message: '商品 正在打开'
            },
            {
                source: 'command-center',
                state: 'saved',
                module: 'commerce-center',
                message: '商品 已打开'
            }
        ]
    );
    assert.deepEqual(JSON.parse(JSON.stringify(window.AdminCommandCenter.getState().quickActionState)), {
        key: 'commerce-center',
        moduleId: 'commerce-center',
        state: 'saved'
    });
});

test('AdminCommandCenter dock magnification only reacts to pointer movement inside the dock rail', () => {
    const { window, elements } = loadCommandCenterRuntime();
    const root = elements.adminCommandCenter;

    const iconStyle = {
        values: {},
        setProperty(name, value) {
            this.values[name] = value;
        },
        removeProperty(name) {
            delete this.values[name];
        }
    };
    const icon = { style: iconStyle };
    const dockButton = {
        dataset: { adminCommandPulse: 'inventory' },
        querySelector(selector) {
            return selector === '.admin-command-center__dock-icon' ? icon : null;
        },
        getBoundingClientRect() {
            return { top: 100, height: 40 };
        }
    };
    const dock = {
        querySelectorAll(selector) {
            return selector === '.admin-command-center__dock-btn' ? [dockButton] : [];
        }
    };

    root.querySelectorAll = (selector) => {
        if (selector === '.admin-command-center__dock-icon') {
            return [icon];
        }
        if (selector === '.admin-command-center__dock-btn') {
            return [dockButton];
        }
        return [];
    };

    root.listeners.pointermove({
        clientX: 120,
        clientY: 120,
        target: {
            closest(selector) {
                return selector === '.admin-command-center__dock' ? dock : null;
            }
        }
    });

    assert.ok(iconStyle.values['--admin-command-dock-scale']);
    assert.ok(window.AdminCommandCenter.getState().dockLiftByPulseId.inventory);

    root.listeners.pointermove({
        clientX: 120,
        clientY: 120,
        target: {
            closest() {
                return null;
            }
        }
    });

    assert.equal(iconStyle.values['--admin-command-dock-scale'], undefined);
    assert.equal(iconStyle.values['--admin-command-dock-rise'], undefined);
    assert.equal(Object.keys(window.AdminCommandCenter.getState().dockLiftByPulseId).length, 0);
});

test('AdminCommandCenter inventory restock action opens shop import instead of commerce analytics', async () => {
    const { window, elements } = loadCommandCenterRuntime();
    const openCalls = [];
    const feedbackSignals = [];

    window.AdminShell.openContext = async (destination, context = {}, options = {}) => {
        openCalls.push({ destination, context, options });
        return true;
    };
    window.dispatchEvent = (event) => {
        if (event?.type === 'admin-feedback-signal') {
            feedbackSignals.push(event.detail);
        }
    };

    elements.adminCommandCenter.listeners.click({
        target: {
            closest(selector) {
                if (selector === '[data-admin-command-pulse]') {
                    return {
                        dataset: {
                            adminCommandPulse: 'inventory'
                        }
                    };
                }
                return null;
            }
        }
    });

    elements.adminCommandCenter.listeners.click({
        target: {
            closest(selector) {
                if (selector === '[data-admin-command-module]') {
                    return {
                        dataset: {
                            adminCommandModule: 'shop',
                            adminCommandStateKey: 'inventory-restock',
                            adminCommandFeedbackLabel: '库存导入',
                            adminCommandIntent: '打开商城系统导入，直接处理补货。',
                            adminCommandContext: JSON.stringify({
                                destination: 'shop',
                                entity: 'shop-inventory',
                                action: 'open-import',
                                payload: {
                                    workspace: 'import',
                                    defaultTab: 'import',
                                    tab: 'import'
                                }
                            }),
                            adminCommandOptions: JSON.stringify({
                                defaultTab: 'import',
                                tab: 'import'
                            })
                        }
                    };
                }
                return null;
            }
        }
    });

    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(JSON.parse(JSON.stringify(openCalls)), [{
        destination: 'shop',
        context: {
            source: 'gallery',
            destination: 'shop',
            reason: 'command-center',
            entity: 'shop-inventory',
            action: 'open-import',
            payload: {
                workspace: 'import',
                defaultTab: 'import',
                tab: 'import'
            }
        },
        options: {
            settleMs: 100
        }
    }]);
    assert.deepEqual(
        feedbackSignals.map((signal) => ({
            module: signal.module,
            state: signal.state,
            message: signal.message
        })),
        [
            {
                module: 'shop',
                state: 'loading',
                message: '库存导入 正在打开'
            },
            {
                module: 'shop',
                state: 'saved',
                message: '库存导入 已打开'
            }
        ]
    );
    assert.match(elements.adminCommandCenter.innerHTML, /data-admin-command-state-key="inventory-restock"[^>]*data-admin-command-state="saved"/);
    assert.match(elements.adminCommandCenter.innerHTML, /data-admin-command-state-key="inventory-orders"[^>]*data-admin-command-state="ready"/);
    assert.match(elements.adminCommandCenter.innerHTML, /打开商城系统导入，直接处理补货。/);
});

test('AdminCommandCenter notifications action opens chat priority reply queue', async () => {
    const { window, elements } = loadCommandCenterRuntime();
    const openCalls = [];

    window.AdminShell.openContext = async (destination, context = {}, options = {}) => {
        openCalls.push({ destination, context, options });
        return true;
    };

    elements.adminCommandCenter.listeners.click({
        target: {
            closest(selector) {
                if (selector === '[data-admin-command-pulse]') {
                    return {
                        dataset: {
                            adminCommandPulse: 'notifications'
                        }
                    };
                }
                return null;
            }
        }
    });

    elements.adminCommandCenter.listeners.click({
        target: {
            closest(selector) {
                if (selector === '[data-admin-command-module]') {
                    return {
                        dataset: {
                            adminCommandModule: 'chat',
                            adminCommandStateKey: 'notifications-reply',
                            adminCommandFeedbackLabel: '消息待回',
                            adminCommandIntent: '打开消息中心高优先待回复队列。',
                            adminCommandContext: JSON.stringify({
                                payload: {
                                    queueView: 'priority',
                                    queueFilter: 'reply'
                                }
                            })
                        }
                    };
                }
                return null;
            }
        }
    });

    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(JSON.parse(JSON.stringify(openCalls)), [{
        destination: 'chat',
        context: {
            source: 'gallery',
            destination: 'chat',
            reason: 'command-center',
            payload: {
                queueView: 'priority',
                queueFilter: 'reply'
            }
        },
        options: {
            settleMs: 100
        }
    }]);
    assert.match(elements.adminCommandCenter.innerHTML, /data-admin-command-state-key="notifications-reply"[^>]*data-admin-command-state="saved"/);
});

test('AdminCommandCenter notification pulse makes active alerts the primary action when messages are clear', () => {
    const { elements, listeners } = loadCommandCenterRuntime();

    listeners['admin-chat-command-summary-updated']({
        detail: {
            ready: true,
            status: 'ready',
            unreadMessages: 0,
            pendingReply: 0,
            systemAlerts: 160,
            unreadSystemAlerts: 0,
            actionableCount: 0,
            recentItems: []
        }
    });

    assert.match(elements.adminCommandCenter.innerHTML, /站内通知[\s\S]*160 条活跃告警/);
    assert.doesNotMatch(elements.adminCommandCenter.innerHTML, /data-admin-command-pulse="notifications"[\s\S]*admin-command-center__badge[\s\S]*160/);

    elements.adminCommandCenter.listeners.click({
        target: {
            closest(selector) {
                if (selector === '[data-admin-command-pulse]') {
                    return {
                        dataset: {
                            adminCommandPulse: 'notifications'
                        }
                    };
                }
                return null;
            }
        }
    });

    assert.match(elements.adminCommandCenter.innerHTML, /活跃告警[\s\S]*160条/);
    assert.match(elements.adminCommandCenter.innerHTML, /未读告警[\s\S]*0条/);
    assert.match(elements.adminCommandCenter.innerHTML, /is-primary[\s\S]*处理告警/);
    assert.match(elements.adminCommandCenter.innerHTML, /data-admin-command-module="ops-alerts"[\s\S]*opsAlertMonitorPanel/);
    assert.match(elements.adminCommandCenter.innerHTML, /data-admin-command-module="ops-alerts"[\s\S]*workspace/);
    assert.match(elements.adminCommandCenter.innerHTML, /当前没有未读提醒，但仍有活跃告警留在工作区/);
    assert.doesNotMatch(elements.adminCommandCenter.innerHTML, /全部已读/);
});

test('AdminCommandCenter payments retry action opens the ops retry queue', async () => {
    const { window, elements } = loadCommandCenterRuntime();
    const openCalls = [];

    window.AdminShell.openContext = async (destination, context = {}, options = {}) => {
        openCalls.push({ destination, context, options });
        return true;
    };

    elements.adminCommandCenter.listeners.click({
        target: {
            closest(selector) {
                if (selector === '[data-admin-command-pulse]') {
                    return {
                        dataset: {
                            adminCommandPulse: 'payments'
                        }
                    };
                }
                return null;
            }
        }
    });

    elements.adminCommandCenter.listeners.click({
        target: {
            closest(selector) {
                if (selector === '[data-admin-command-module]') {
                    return {
                        dataset: {
                            adminCommandModule: 'payments',
                            adminCommandStateKey: 'payments-retry',
                            adminCommandFeedbackLabel: '回调重试',
                            adminCommandIntent: '打开支付运维页的待重试回调。',
                            adminCommandContext: JSON.stringify({
                                payload: {
                                    defaultTab: 'ops',
                                    tab: 'ops',
                                    issueSummary: 'retry',
                                    focusTargetId: 'paymentsOpsAlertQueue'
                                }
                            }),
                            adminCommandOptions: JSON.stringify({
                                defaultTab: 'ops',
                                tab: 'ops'
                            })
                        }
                    };
                }
                return null;
            }
        }
    });

    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(JSON.parse(JSON.stringify(openCalls)), [{
        destination: 'payments',
        context: {
            source: 'gallery',
            destination: 'payments',
            reason: 'command-center',
            payload: {
                defaultTab: 'ops',
                tab: 'ops',
                issueSummary: 'retry',
                focusTargetId: 'paymentsOpsAlertQueue'
            }
        },
        options: {
            settleMs: 100
        }
    }]);
    assert.match(elements.adminCommandCenter.innerHTML, /data-admin-command-state-key="payments-retry"[^>]*data-admin-command-state="saved"/);
});

test('AdminCommandCenter budget settings action falls back to the general settings focus target', async () => {
    const { window, elements } = loadCommandCenterRuntime();
    const helperCalls = [];

    window.openAdminSettingsShellContext = async (context = {}, options = {}) => {
        helperCalls.push({ context, options });
        return true;
    };

    elements.adminCommandCenter.listeners.click({
        target: {
            closest(selector) {
                if (selector === '[data-admin-command-pulse]') {
                    return {
                        dataset: {
                            adminCommandPulse: 'budget'
                        }
                    };
                }
                return null;
            }
        }
    });

    elements.adminCommandCenter.listeners.click({
        target: {
            closest(selector) {
                if (selector === '[data-admin-command-module]') {
                    return {
                        dataset: {
                            adminCommandModule: 'settings',
                            adminCommandStateKey: 'budget-settings',
                            adminCommandFeedbackLabel: 'AI 配置',
                            adminCommandIntent: '打开通用设置中的 Codex Relay 配置入口。',
                            adminCommandContext: JSON.stringify({
                                action: 'general',
                                payload: {
                                    defaultTab: 'general',
                                    focusTargetId: 'codexConfigPanel'
                                }
                            }),
                            adminCommandOptions: JSON.stringify({
                                viewName: 'general',
                                settingsView: 'general',
                                focusTargetId: 'codexConfigPanel'
                            })
                        }
                    };
                }
                return null;
            }
        }
    });

    await Promise.resolve();
    await Promise.resolve();

    assert.deepEqual(JSON.parse(JSON.stringify(helperCalls)), [{
        context: {
            source: 'gallery',
            destination: 'settings',
            reason: 'command-center',
            action: 'general',
            payload: {
                defaultTab: 'general',
                focusTargetId: 'codexConfigPanel'
            }
        },
        options: {
            viewName: 'general',
            settingsView: 'general',
            focusTargetId: 'codexConfigPanel'
        }
    }]);
});

test('AdminCommandCenter renders recent timeline rows as direct action entries when live summaries provide routing metadata', () => {
    const { elements } = loadCommandCenterRuntime();

    elements.adminCommandCenter.listeners.click({
        target: {
            closest(selector) {
                if (selector === '[data-admin-command-pulse]') {
                    return {
                        dataset: {
                            adminCommandPulse: 'notifications'
                        }
                    };
                }
                return null;
            }
        }
    });

    assert.match(elements.adminCommandCenter.innerHTML, /admin-command-center__timeline-item--action/);
    assert.match(elements.adminCommandCenter.innerHTML, /data-admin-command-state-key="notifications-session-session_alice"/);
    assert.match(elements.adminCommandCenter.innerHTML, /打开 Alice 会话。/);
});

test('AdminCommandCenter recent timeline row opens the targeted security audit workspace', async () => {
    const { window, elements } = loadCommandCenterRuntime();
    const helperCalls = [];

    window.openAdminSettingsShellContext = async (context = {}, options = {}) => {
        helperCalls.push({ context, options });
        return true;
    };

    elements.adminCommandCenter.listeners.click({
        target: {
            closest(selector) {
                if (selector === '[data-admin-command-module]') {
                    return {
                        dataset: {
                            adminCommandModule: 'settings',
                            adminCommandStateKey: 'security-config-mock-switch',
                            adminCommandFeedbackLabel: '配置审计',
                            adminCommandIntent: '打开安全审计中的配置变更记录。',
                            adminCommandContext: JSON.stringify({
                                action: 'security',
                                payload: {
                                    defaultTab: 'security',
                                    workspace: 'admin-audit-monitor',
                                    focusTargetId: 'adminAuditMonitorConfigList'
                                }
                            }),
                            adminCommandOptions: JSON.stringify({
                                viewName: 'security',
                                settingsView: 'security',
                                workspace: 'admin-audit-monitor'
                            })
                        }
                    };
                }
                return null;
            }
        }
    });

    await Promise.resolve();
    await Promise.resolve();

    assert.deepEqual(JSON.parse(JSON.stringify(helperCalls)), [{
        context: {
            source: 'gallery',
            destination: 'settings',
            reason: 'command-center',
            action: 'security',
            payload: {
                defaultTab: 'security',
                workspace: 'admin-audit-monitor',
                focusTargetId: 'adminAuditMonitorConfigList'
            }
        },
        options: {
            viewName: 'security',
            settingsView: 'security',
            workspace: 'admin-audit-monitor'
        }
    }]);
});

test('AdminCommandCenter recent ops alert row opens the mapped workbench workspace directly', async () => {
    const { window, elements } = loadCommandCenterRuntime();
    const workbenchCalls = [];

    window.openAdminWorkbenchEntry = async (workspaceKey, context = {}) => {
        workbenchCalls.push({ workspaceKey, context });
        return true;
    };

    elements.adminCommandCenter.listeners.click({
        target: {
            closest(selector) {
                if (selector === '[data-admin-command-module]') {
                    return {
                        dataset: {
                            adminCommandModule: 'ops-workspace',
                            adminCommandStateKey: 'notifications-alert-verify-backlog',
                            adminCommandFeedbackLabel: '查看验证面板',
                            adminCommandIntent: '打开这条告警对应的查看验证面板工作位。',
                            adminCommandContext: JSON.stringify({
                                alertType: 'verify_queue_backlog',
                                referenceLabel: '验证队列',
                                referenceValue: '验证码会话出现超时积压'
                            }),
                            adminCommandOptions: JSON.stringify({
                                workspaceKey: 'verify-monitor'
                            })
                        }
                    };
                }
                return null;
            }
        }
    });

    await Promise.resolve();
    await Promise.resolve();

    assert.deepEqual(JSON.parse(JSON.stringify(workbenchCalls)), [{
        workspaceKey: 'verify-monitor',
        context: {
            source: 'gallery',
            destination: 'ops-workspace',
            reason: 'command-center',
            alertType: 'verify_queue_backlog',
            referenceLabel: '验证队列',
            referenceValue: '验证码会话出现超时积压',
            payload: {}
        }
    }]);
});

test('AdminCommandCenter pulse timeline prefers recent real feedback over static sample copy', () => {
    const { listeners, elements } = loadCommandCenterRuntime();

    listeners['admin-feedback-signal']({
        detail: {
            source: 'payments-batch',
            state: 'partial',
            module: 'payments',
            pulseId: 'payments',
            message: '回调重试队列仍有 2 单失败',
            timestamp: Date.now()
        }
    });

    elements.adminCommandCenter.listeners.click({
        target: {
            closest(selector) {
                if (selector === '[data-admin-command-pulse]') {
                    return {
                        dataset: {
                            adminCommandPulse: 'payments'
                        }
                    };
                }
                return null;
            }
        }
    });

    assert.match(elements.adminCommandCenter.innerHTML, /回调重试队列仍有 2 单失败/);
    assert.doesNotMatch(elements.adminCommandCenter.innerHTML, /订单 #A1029 回调等待重试/);
});
