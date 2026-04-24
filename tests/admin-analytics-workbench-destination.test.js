const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const analyticsWorkbenchPath = path.resolve(__dirname, '../js/admin-analytics-workbench.js');

function loadAnalyticsWorkbenchRuntime(options = {}) {
    const script = fs.readFileSync(analyticsWorkbenchPath, 'utf8');
    const shellCalls = [];
    const activateCalls = [];
    const switchCalls = [];
    const selectedSites = [];

    function HTMLElement() {}

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
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {
            return true;
        },
        localStorage: {
            getItem() {
                return null;
            },
            setItem() {},
            removeItem() {}
        },
        AdminSiteFilter: {
            getSiteFilter() {
                return 'all';
            },
            select(site) {
                selectedSites.push(String(site || ''));
            }
        },
        showToast() {},
        switchModule(moduleName, switchOptions = {}) {
            switchCalls.push({ moduleName, options: switchOptions });
            if (typeof options.switchModuleImpl === 'function') {
                return options.switchModuleImpl(moduleName, switchOptions);
            }
            return true;
        }
    };

    if (options.withShell !== false) {
        window.AdminShell = {
            async openContext(moduleName, context = {}, shellOptions = {}) {
                shellCalls.push({ moduleName, context, options: shellOptions });
                if (typeof options.openContextImpl === 'function') {
                    return options.openContextImpl(moduleName, context, shellOptions);
                }
                return true;
            },
            activateModule(moduleName, activationOptions = {}) {
                activateCalls.push({ moduleName, options: activationOptions });
                if (typeof options.activateModuleImpl === 'function') {
                    return options.activateModuleImpl(moduleName, activationOptions);
                }
                return true;
            }
        };
    }

    const document = {
        getElementById() {
            return null;
        },
        querySelectorAll() {
            return [];
        }
    };

    const context = {
        console: {
            warn() {},
            log() {},
            error() {}
        },
        window,
        document,
        globalThis: window,
        HTMLElement,
        CustomEvent: function CustomEvent(type, init) {
            this.type = type;
            this.detail = init?.detail;
        },
        URL,
        URLSearchParams,
        DEFAULT_ANALYTICS_DAYS: 7,
        getAnalyticsRangeState() {
            return {
                days: 7,
                startDate: '',
                endDate: ''
            };
        },
        getAnalyticsSiteParam() {
            return '';
        },
        isAnalyticsModuleVisible() {
            return false;
        },
        switchAnalyticsTab() {},
        setAnalyticsAdvancedWorkspaceOpen() {},
        openAnalyticsContentCommerceDetail() {},
        openAnalyticsProductDetail() {},
        fetch: async () => ({
            ok: true,
            async json() {
                return {};
            }
        })
    };

    window.window = window;
    window.document = document;
    window.HTMLElement = HTMLElement;

    vm.runInNewContext(script, context);

    return {
        ...context,
        window,
        shellCalls,
        activateCalls,
        switchCalls,
        selectedSites
    };
}

test('analytics workbench payments context prefers AdminShell routing before direct module fallback', async () => {
    const runtime = loadAnalyticsWorkbenchRuntime({
        switchModuleImpl() {
            throw new Error('payments fallback should not run');
        }
    });

    const opened = await runtime.openAnalyticsPaymentsContext('ops', {
        site: 'intl',
        exceptionTopic: 'gateway_recovery',
        focusTargetId: 'paymentsExceptionTopics'
    });

    assert.equal(opened, true);
    assert.deepEqual(JSON.parse(JSON.stringify(runtime.shellCalls)), [{
        moduleName: 'payments',
        context: {
            source: 'analytics',
            entity: 'payments-overview',
            action: 'focus-exception-topic',
            site: 'intl',
            focus: {
                paymentOrderId: '',
                payment_order_id: ''
            },
            payload: {
                site: 'intl',
                exceptionTopic: 'gateway_recovery',
                focusTargetId: 'paymentsExceptionTopics',
                workspace: 'ops',
                defaultTab: 'ops',
                tab: 'ops',
                exception_topic: 'gateway_recovery',
                focus_target_id: 'paymentsExceptionTopics'
            }
        },
        options: {
            settleMs: 0,
            silentDenied: true
        }
    }]);
    assert.equal(runtime.switchCalls.length, 0);
});

test('analytics workbench ticket context prefers AdminShell routing before direct ticket focus fallback', async () => {
    const runtime = loadAnalyticsWorkbenchRuntime({
        switchModuleImpl() {
            throw new Error('tickets fallback should not run');
        }
    });

    const opened = await runtime.openAnalyticsTicketsContext('pending', {
        site: 'cn',
        ticketId: 'ticket-123',
        status: 'pending',
        replyAction: 'rejected',
        focusTargetId: 'ticketsQueueControls'
    });

    assert.equal(opened, true);
    assert.deepEqual(JSON.parse(JSON.stringify(runtime.shellCalls)), [{
        moduleName: 'tickets',
        context: {
            source: 'analytics',
            entity: 'ticket',
            action: 'focus-ticket',
            site: 'cn',
            focus: {
                ticketId: 'ticket-123',
                ticket_id: 'ticket-123'
            },
            payload: {
                site: 'cn',
                ticketId: 'ticket-123',
                status: 'pending',
                replyAction: 'rejected',
                focusTargetId: 'ticketsQueueControls',
                workspace: 'queue',
                mode: 'pending',
                search: '',
                searchQuery: '',
                query: '',
                quickFilter: '',
                assignee: '',
                focus_target_id: 'ticketsQueueControls'
            }
        },
        options: {
            settleMs: 0,
            silentDenied: true
        }
    }]);
    assert.equal(runtime.switchCalls.length, 0);
});

test('analytics destination shop-orders prefers AdminShell routing and applies site context first', async () => {
    const runtime = loadAnalyticsWorkbenchRuntime({
        switchModuleImpl() {
            throw new Error('shop fallback should not run');
        }
    });

    const opened = runtime.window.openAnalyticsDestination('shop-orders', {
        site: 'intl',
        orderId: 'ORDER-123',
        productName: 'Spring Pack',
        referenceLabel: '订单号',
        referenceValue: 'ORDER-123'
    });

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(opened, true);
    assert.deepEqual(runtime.selectedSites, ['intl']);
    assert.deepEqual(JSON.parse(JSON.stringify(runtime.shellCalls)), [{
        moduleName: 'shop',
        context: {
            source: 'analytics',
            entity: 'shop-order',
            action: 'focus-order',
            site: 'intl',
            focus: {
                productId: '',
                product_id: '',
                inventoryId: '',
                inventory_id: '',
                orderId: 'ORDER-123',
                order_id: 'ORDER-123',
                taskId: '',
                task_id: ''
            },
            payload: {
                site: 'intl',
                orderId: 'ORDER-123',
                productName: 'Spring Pack',
                referenceLabel: '订单号',
                referenceValue: 'ORDER-123',
                refundStatus: '',
                deliveryStatus: '',
                productId: '',
                userId: '',
                email: '',
                signalSourceName: '',
                signalLabel: '',
                signalValue: '',
                rangeLabel: '',
                query: 'Spring Pack',
                queryLabel: '',
                workspace: 'orders',
                defaultTab: 'orders',
                tab: 'orders',
                search: 'Spring Pack',
                searchQuery: 'Spring Pack',
                openDetails: true,
                taskId: '',
                task_id: ''
            }
        },
        options: {
            settleMs: 0,
            silentDenied: true
        }
    }]);
    assert.equal(runtime.switchCalls.length, 0);
});

test('analytics destination shop-orders falls back to the shared shop context helper after shell activation', async () => {
    const runtime = loadAnalyticsWorkbenchRuntime({
        openContextImpl() {
            return false;
        }
    });
    const helperCalls = [];

    runtime.window.openAdminShopShellContext = async (context = {}, options = {}) => {
        helperCalls.push({ context, options });
        return true;
    };

    const opened = await runtime.openAnalyticsShopContext('orders', {
        site: 'intl',
        orderId: 'ORDER-123',
        productName: 'Spring Pack',
        referenceLabel: '订单号',
        referenceValue: 'ORDER-123'
    });

    assert.equal(opened, true);
    assert.equal(runtime.switchCalls.length, 0);
    assert.equal(runtime.activateCalls.length, 1);
    assert.equal(runtime.activateCalls[0].moduleName, 'shop');
    assert.equal(runtime.activateCalls[0].options.deferContext, true);
    assert.equal(runtime.activateCalls[0].options.reason, 'analytics-destination-fallback');
    assert.deepEqual(JSON.parse(JSON.stringify(helperCalls)), [{
        context: {
            source: 'analytics',
            entity: 'shop-order',
            action: 'focus-order',
            site: 'intl',
            focus: {
                productId: '',
                product_id: '',
                inventoryId: '',
                inventory_id: '',
                orderId: 'ORDER-123',
                order_id: 'ORDER-123',
                taskId: '',
                task_id: ''
            },
            payload: {
                site: 'intl',
                orderId: 'ORDER-123',
                productName: 'Spring Pack',
                referenceLabel: '订单号',
                referenceValue: 'ORDER-123',
                refundStatus: '',
                deliveryStatus: '',
                productId: '',
                userId: '',
                email: '',
                signalSourceName: '',
                signalLabel: '',
                signalValue: '',
                rangeLabel: '',
                query: 'Spring Pack',
                queryLabel: '',
                workspace: 'orders',
                defaultTab: 'orders',
                tab: 'orders',
                search: 'Spring Pack',
                searchQuery: 'Spring Pack',
                taskId: '',
                task_id: '',
                openDetails: true
            }
        },
        options: {
            defaultTab: 'orders',
            tab: 'orders',
            load: false
        }
    }]);
    assert.deepEqual(JSON.parse(JSON.stringify(runtime.activateCalls[0].options.context)), JSON.parse(JSON.stringify(helperCalls[0].context)));
});

test('analytics workbench payments context falls back to the shared payments context helper after shell activation', async () => {
    const runtime = loadAnalyticsWorkbenchRuntime({
        openContextImpl() {
            return false;
        }
    });
    const helperCalls = [];

    runtime.window.openAdminPaymentsShellContext = async (context = {}, options = {}) => {
        helperCalls.push({ context, options });
        return true;
    };

    const opened = await runtime.openAnalyticsPaymentsContext('ops', {
        site: 'intl',
        exceptionTopic: 'gateway_recovery',
        focusTargetId: 'paymentsExceptionTopics'
    });

    assert.equal(opened, true);
    assert.equal(runtime.switchCalls.length, 0);
    assert.equal(runtime.activateCalls.length, 1);
    assert.equal(runtime.activateCalls[0].moduleName, 'payments');
    assert.equal(runtime.activateCalls[0].options.deferContext, true);
    assert.equal(runtime.activateCalls[0].options.reason, 'analytics-destination-fallback');
    assert.deepEqual(JSON.parse(JSON.stringify(helperCalls)), [{
        context: {
            source: 'analytics',
            entity: 'payments-overview',
            action: 'focus-exception-topic',
            site: 'intl',
            focus: {
                paymentOrderId: '',
                payment_order_id: ''
            },
            payload: {
                site: 'intl',
                exceptionTopic: 'gateway_recovery',
                focusTargetId: 'paymentsExceptionTopics',
                workspace: 'ops',
                defaultTab: 'ops',
                tab: 'ops',
                exception_topic: 'gateway_recovery',
                focus_target_id: 'paymentsExceptionTopics'
            }
        },
        options: {
            defaultTab: 'ops',
            tab: 'ops'
        }
    }]);
    assert.deepEqual(JSON.parse(JSON.stringify(runtime.activateCalls[0].options.context)), JSON.parse(JSON.stringify(helperCalls[0].context)));
});

test('analytics workbench ticket context falls back to the shared tickets context helper after shell activation', async () => {
    const runtime = loadAnalyticsWorkbenchRuntime({
        openContextImpl() {
            return false;
        }
    });
    const helperCalls = [];

    runtime.window.openAdminTicketsShellContext = async (context = {}, options = {}) => {
        helperCalls.push({ context, options });
        return true;
    };

    const opened = await runtime.openAnalyticsTicketsContext('pending', {
        site: 'cn',
        ticketId: 'ticket-123',
        status: 'pending',
        replyAction: 'rejected',
        focusTargetId: 'ticketsQueueControls'
    });

    assert.equal(opened, true);
    assert.equal(runtime.switchCalls.length, 0);
    assert.equal(runtime.activateCalls.length, 1);
    assert.equal(runtime.activateCalls[0].moduleName, 'tickets');
    assert.equal(runtime.activateCalls[0].options.deferContext, true);
    assert.equal(runtime.activateCalls[0].options.reason, 'analytics-destination-fallback');
    assert.deepEqual(JSON.parse(JSON.stringify(helperCalls)), [{
        context: {
            source: 'analytics',
            entity: 'ticket',
            action: 'focus-ticket',
            site: 'cn',
            focus: {
                ticketId: 'ticket-123',
                ticket_id: 'ticket-123'
            },
            payload: {
                site: 'cn',
                ticketId: 'ticket-123',
                status: 'pending',
                replyAction: 'rejected',
                focusTargetId: 'ticketsQueueControls',
                workspace: 'queue',
                mode: 'pending',
                search: '',
                searchQuery: '',
                query: '',
                quickFilter: '',
                assignee: '',
                focus_target_id: 'ticketsQueueControls'
            }
        },
        options: {
            workspace: 'queue'
        }
    }]);
    assert.deepEqual(JSON.parse(JSON.stringify(runtime.activateCalls[0].options.context)), JSON.parse(JSON.stringify(helperCalls[0].context)));
});

test('analytics destination settings-google-one prefers AdminShell routing before direct settings fallback', async () => {
    const runtime = loadAnalyticsWorkbenchRuntime({
        switchModuleImpl() {
            throw new Error('settings fallback should not run');
        }
    });

    const opened = runtime.window.openAnalyticsDestination('settings-google-one', {
        site: 'cn',
        sectionId: 'verifyMonitorWorkspace'
    });

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(opened, true);
    assert.deepEqual(JSON.parse(JSON.stringify(runtime.shellCalls)), [{
        moduleName: 'settings',
        context: {
            source: 'analytics',
            entity: 'verify-monitor',
            action: 'open-verify-monitor',
            site: 'cn',
            payload: {
                site: 'cn',
                sectionId: 'verifyMonitorWorkspace',
                workspace: 'verify-monitor',
                defaultTab: 'google-one',
                tab: 'google-one'
            }
        },
        options: {
            settleMs: 0,
            silentDenied: true
        }
    }]);
    assert.equal(runtime.switchCalls.length, 0);
});

test('analytics destination points prefers AdminShell routing before direct points fallback', async () => {
    const runtime = loadAnalyticsWorkbenchRuntime({
        switchModuleImpl() {
            throw new Error('points fallback should not run');
        }
    });

    const opened = runtime.window.openAnalyticsDestination('points', {
        site: 'cn',
        view: 'catalog'
    });

    await Promise.resolve();
    await Promise.resolve();

    assert.equal(opened, true);
    assert.deepEqual(JSON.parse(JSON.stringify(runtime.shellCalls)), [{
        moduleName: 'points',
        context: {
            source: 'analytics',
            entity: 'points',
            action: 'open-catalog',
            site: 'cn',
            payload: {
                site: 'cn',
                view: 'catalog',
                batchId: '',
                code: '',
                lookupValue: '',
                search: ''
            }
        },
        options: {
            settleMs: 0,
            silentDenied: true
        }
    }]);
    assert.equal(runtime.switchCalls.length, 0);
});

test('analytics destination comments-guestbook falls back to the shared comments context helper after shell activation', async () => {
    const runtime = loadAnalyticsWorkbenchRuntime({
        openContextImpl() {
            return false;
        }
    });
    const helperCalls = [];

    runtime.window.openAdminCommentsShellContext = async (context = {}, options = {}) => {
        helperCalls.push({ context, options });
        return true;
    };

    const opened = runtime.window.openAnalyticsDestination('comments-guestbook', {
        site: 'cn',
        commentId: 'comment-123',
        search: 'comment-123'
    });

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(opened, true);
    assert.equal(runtime.switchCalls.length, 0);
    assert.equal(runtime.activateCalls.length, 1);
    assert.equal(runtime.activateCalls[0].moduleName, 'comments');
    assert.equal(runtime.activateCalls[0].options.deferContext, true);
    assert.equal(runtime.activateCalls[0].options.reason, 'analytics-destination-fallback');
    assert.deepEqual(JSON.parse(JSON.stringify(helperCalls)), [{
        context: {
            source: 'analytics',
            entity: 'comment',
            action: 'focus-comment',
            site: 'cn',
            focus: {
                promptId: '',
                prompt_id: '',
                commentId: 'comment-123',
                comment_id: 'comment-123'
            },
            payload: {
                site: 'cn',
                commentId: 'comment-123',
                search: 'comment-123',
                view: 'guestbook',
                commentView: 'guestbook',
                queue: 'pending',
                promptTitle: ''
            }
        },
        options: {}
    }]);
    assert.deepEqual(JSON.parse(JSON.stringify(runtime.activateCalls[0].options.context)), JSON.parse(JSON.stringify(helperCalls[0].context)));
});

test('analytics destination ops-alerts-health prefers AdminShell routing before direct ops alerts fallback', async () => {
    const runtime = loadAnalyticsWorkbenchRuntime({
        switchModuleImpl() {
            throw new Error('ops alerts fallback should not run');
        }
    });

    const opened = runtime.window.openAnalyticsDestination('ops-alerts-health', {
        site: 'intl',
        sectionId: 'opsAlertHealthPanel'
    });

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(opened, true);
    assert.deepEqual(JSON.parse(JSON.stringify(runtime.shellCalls)), [{
        moduleName: 'ops-alerts',
        context: {
            source: 'analytics',
            entity: 'ops-alerts-health',
            action: 'open-health',
            site: 'intl',
            payload: {
                site: 'intl',
                sectionId: 'opsAlertHealthPanel',
                view: 'health',
                focusTargetId: 'opsAlertHealthPanel',
                focus_target_id: 'opsAlertHealthPanel'
            }
        },
        options: {
            settleMs: 0,
            silentDenied: true
        }
    }]);
    assert.equal(runtime.switchCalls.length, 0);
});

test('analytics destination ops-alerts-workspace falls back to the shared ops alerts context helper after shell activation', async () => {
    const runtime = loadAnalyticsWorkbenchRuntime({
        openContextImpl() {
            return false;
        }
    });
    const helperCalls = [];

    runtime.window.openAdminOpsAlertsShellContext = async (context = {}, options = {}) => {
        helperCalls.push({ context, options });
        return true;
    };

    const opened = runtime.window.openAnalyticsDestination('ops-alerts-workspace', {
        site: 'cn',
        sectionId: 'opsAlertMonitorPanel'
    });

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(opened, true);
    assert.equal(runtime.switchCalls.length, 0);
    assert.equal(runtime.activateCalls.length, 1);
    assert.equal(runtime.activateCalls[0].moduleName, 'ops-alerts');
    assert.equal(runtime.activateCalls[0].options.deferContext, true);
    assert.equal(runtime.activateCalls[0].options.reason, 'analytics-destination-fallback');
    assert.deepEqual(JSON.parse(JSON.stringify(helperCalls)), [{
        context: {
            source: 'analytics',
            entity: 'ops-alerts-workspace',
            action: 'open-workspace',
            site: 'cn',
            payload: {
                site: 'cn',
                sectionId: 'opsAlertMonitorPanel',
                view: 'workspace',
                focusTargetId: 'opsAlertMonitorPanel',
                focus_target_id: 'opsAlertMonitorPanel'
            }
        },
        options: {
            viewName: 'workspace'
        }
    }]);
    assert.deepEqual(JSON.parse(JSON.stringify(runtime.activateCalls[0].options.context)), JSON.parse(JSON.stringify(helperCalls[0].context)));
});

test('analytics destination settings-affiliate falls back to the shared settings context helper after shell activation', async () => {
    const runtime = loadAnalyticsWorkbenchRuntime({
        openContextImpl() {
            return false;
        }
    });
    const helperCalls = [];

    runtime.window.openAdminSettingsShellContext = async (context = {}, options = {}) => {
        helperCalls.push({ context, options });
        return true;
    };

    const opened = runtime.window.openAnalyticsDestination('settings-affiliate', {
        site: 'intl',
        sectionId: 'affiliatePosterEditor'
    });

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(opened, true);
    assert.equal(runtime.switchCalls.length, 0);
    assert.equal(runtime.activateCalls.length, 1);
    assert.equal(runtime.activateCalls[0].moduleName, 'settings');
    assert.equal(runtime.activateCalls[0].options.deferContext, true);
    assert.equal(runtime.activateCalls[0].options.reason, 'analytics-destination-fallback');
    assert.deepEqual(JSON.parse(JSON.stringify(helperCalls)), [{
        context: {
            source: 'analytics',
            entity: 'affiliate',
            action: 'open-affiliate',
            site: 'intl',
            payload: {
                site: 'intl',
                sectionId: 'affiliatePosterEditor',
                workspace: 'affiliate',
                defaultTab: 'affiliate',
                tab: 'affiliate'
            }
        },
        options: {
            viewName: 'affiliate',
            settingsView: 'affiliate'
        }
    }]);
    assert.deepEqual(JSON.parse(JSON.stringify(runtime.activateCalls[0].options.context)), JSON.parse(JSON.stringify(helperCalls[0].context)));
});

test('analytics destination users falls back to the shared users context helper after shell activation', async () => {
    const runtime = loadAnalyticsWorkbenchRuntime({
        openContextImpl() {
            return false;
        }
    });
    const helperCalls = [];

    runtime.window.openAdminUsersShellContext = async (context = {}, options = {}) => {
        helperCalls.push({ context, options });
        return true;
    };

    const opened = runtime.window.openAnalyticsDestination('users', {
        site: 'cn',
        userId: 'user-123',
        email: 'ops@example.com'
    });

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(opened, true);
    assert.equal(runtime.switchCalls.length, 0);
    assert.equal(runtime.activateCalls.length, 1);
    assert.equal(runtime.activateCalls[0].moduleName, 'users');
    assert.equal(runtime.activateCalls[0].options.deferContext, true);
    assert.equal(runtime.activateCalls[0].options.reason, 'analytics-destination-fallback');
    assert.deepEqual(JSON.parse(JSON.stringify(helperCalls)), [{
        context: {
            source: 'analytics',
            entity: 'user',
            action: 'open-user',
            site: 'cn',
            focus: {
                userId: 'user-123',
                user_id: 'user-123'
            },
            payload: {
                site: 'cn',
                userId: 'user-123',
                email: 'ops@example.com',
                analyticsContext: null,
                search: 'user-123',
                searchQuery: 'user-123',
                query: 'user-123'
            }
        },
        options: {
            silentOnNotFound: true
        }
    }]);
    assert.deepEqual(JSON.parse(JSON.stringify(runtime.activateCalls[0].options.context)), JSON.parse(JSON.stringify(helperCalls[0].context)));
});
