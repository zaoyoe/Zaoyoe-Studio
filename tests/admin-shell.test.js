const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const adminShellPath = path.resolve(__dirname, '../js/admin-shell.js');

function loadAdminShellRuntime(options = {}) {
    const script = fs.readFileSync(adminShellPath, 'utf8');
    const switchCalls = [];
    const events = [];
    const modalCalls = [];
    const state = {
        activeModuleId: String(options.activeModuleId || 'comments').trim()
    };
    const window = {
        setTimeout(handler) {
            if (typeof handler === 'function') {
                handler();
            }
            return 1;
        },
        dispatchEvent(event) {
            events.push(event);
            return true;
        },
        switchModule(moduleName, switchOptions) {
            switchCalls.push({ moduleName, options: switchOptions || {} });
            state.activeModuleId = String(moduleName || '').trim();
            return options.switchResult !== false;
        },
        openUserModal(userId, modalOptions) {
            modalCalls.push({ userId, options: modalOptions || {} });
            return true;
        },
        AdminSiteFilter: {
            getSiteFilter() {
                return 'cn';
            }
        }
    };
    const document = {
        querySelector(selector) {
            if (selector === '.module-container.active') {
                return { id: `module-${state.activeModuleId}` };
            }
            if (selector === '.sidebar-item.active[data-module]') {
                return { dataset: { module: state.activeModuleId } };
            }
            return null;
        },
        getElementById() {
            return null;
        }
    };
    const context = {
        console: {
            warn() {},
            log() {},
            error() {}
        },
        CustomEvent: function CustomEvent(type, init) {
            this.type = type;
            this.detail = init?.detail;
        },
        document,
        window,
        globalThis: window
    };

    window.window = window;
    window.document = document;
    vm.runInNewContext(script, context);
    return {
        window,
        switchCalls,
        events,
        modalCalls,
        state
    };
}

test('admin shell wraps module switching and delivers structured context to registered modules', async () => {
    const { window, switchCalls, events } = loadAdminShellRuntime();
    const receivedContexts = [];

    window.AdminShell.registerModule('tickets', {
        handleContext(context) {
            receivedContexts.push(context);
        }
    });

    const opened = await window.AdminShell.openContext('tickets', {
        source: 'comments',
        entity: 'ticket',
        action: 'open-ticket-context',
        focus: {
            ticketId: 'ticket_123'
        },
        payload: {
            status: 'all'
        }
    }, {
        settleMs: 0
    });

    assert.equal(opened, true);
    assert.equal(switchCalls.length, 1);
    assert.equal(switchCalls[0].moduleName, 'tickets');
    assert.equal(switchCalls[0].options.fallback, false);
    assert.equal(receivedContexts.length, 1);
    assert.equal(receivedContexts[0].source, 'comments');
    assert.equal(receivedContexts[0].destination, 'tickets');
    assert.equal(receivedContexts[0].action, 'open-ticket-context');
    assert.equal(receivedContexts[0].focus.ticketId, 'ticket_123');
    const contextEvent = events.find((event) => event.type === 'admin-shell-context');
    assert.ok(contextEvent);
    assert.equal(contextEvent.detail.delivery.status, 'delivered');
    assert.equal(contextEvent.detail.delivery.handled, true);
});

test('admin shell site-change bus calls the active module registered handler', () => {
    const { window } = loadAdminShellRuntime({ activeModuleId: 'users' });
    const handled = [];

    window.AdminShell.registerSiteChangeHandler('users', (detail) => {
        handled.push(detail);
    });

    const result = window.AdminShell.handleSiteChange({
        site: 'intl',
        writableSite: 'intl',
        isAllSitesSelected: false
    });

    assert.equal(result, true);
    assert.equal(handled.length, 1);
    assert.equal(handled[0].site, 'intl');
});

test('admin shell default user context opens the user modal after switching modules', async () => {
    const { window, modalCalls } = loadAdminShellRuntime({ activeModuleId: 'comments' });

    const opened = await window.AdminShell.openContext('users', {
        source: 'comments',
        entity: 'user',
        focus: {
            userId: 'user_123'
        },
        payload: {
            modalOptions: {
                defaultTab: 'content'
            }
        }
    }, {
        settleMs: 0,
        attempts: 1,
        delayMs: 0
    });

    assert.equal(opened, true);
    assert.equal(modalCalls.length, 1);
    assert.equal(modalCalls[0].userId, 'user_123');
    assert.equal(modalCalls[0].options.defaultTab, 'content');
});

test('admin shell default shop context focuses order details through ShopAdmin when the module runtime has not registered yet', async () => {
    const { window } = loadAdminShellRuntime({ activeModuleId: 'analytics' });
    const focusCalls = [];
    const activationCalls = [];

    window.ShopAdmin = {
        async activate(context = {}, options = {}) {
            activationCalls.push({ context, options });
            return true;
        },
        async focusOrder(orderId, options = {}) {
            focusCalls.push({ orderId, options });
            return { opened: true, matched: true };
        }
    };

    const opened = await window.AdminShell.openContext('shop', {
        source: 'analytics',
        entity: 'shop-order',
        focus: {
            orderId: 'ORDER_123'
        },
        payload: {
            workspace: 'orders',
            openDetails: true,
            referenceLabel: '订单号',
            referenceValue: 'ORDER_123'
        }
    }, {
        settleMs: 0,
        attempts: 1,
        delayMs: 0
    });

    assert.equal(opened, true);
    assert.equal(activationCalls.length, 1);
    assert.equal(activationCalls[0].options.defaultTab, 'orders');
    assert.equal(activationCalls[0].options.tab, 'orders');
    assert.deepEqual(JSON.parse(JSON.stringify(focusCalls)), [{
        orderId: 'ORDER_123',
        options: {
            openDetails: true,
            context: {
                workspace: 'orders',
                openDetails: true,
                referenceLabel: '订单号',
                referenceValue: 'ORDER_123'
            }
        }
    }]);
});

test('admin shell default site-change fallback refreshes chat through the exported shell helper', async () => {
    const { window } = loadAdminShellRuntime({ activeModuleId: 'chat' });
    const siteChangeCalls = [];

    window.handleAdminChatModuleSiteChange = async () => {
        siteChangeCalls.push(true);
        return true;
    };

    const result = window.AdminShell.handleSiteChange({
        site: 'intl',
        writableSite: 'intl',
        isAllSitesSelected: false
    });

    assert.equal(result, true);
    assert.equal(siteChangeCalls.length, 1);
});

test('admin shell default site-change fallback refreshes users through the exported shell helper', async () => {
    const { window } = loadAdminShellRuntime({ activeModuleId: 'users' });
    const siteChangeCalls = [];

    window.handleAdminUsersSiteChange = async () => {
        siteChangeCalls.push(true);
        return true;
    };

    const result = window.AdminShell.handleSiteChange({
        site: 'intl',
        writableSite: 'intl',
        isAllSitesSelected: false
    });

    assert.equal(result, true);
    assert.equal(siteChangeCalls.length, 1);
});

test('admin shell default site-change fallback refreshes homepage, points, and growth center through exported helpers', async () => {
    const homepageRuntime = loadAdminShellRuntime({ activeModuleId: 'homepage' });
    const pointsRuntime = loadAdminShellRuntime({ activeModuleId: 'points' });
    const growthRuntime = loadAdminShellRuntime({ activeModuleId: 'growth-center' });
    const homepageCalls = [];
    const pointsCalls = [];
    const growthCalls = [];

    homepageRuntime.window.handleAdminHomepageSiteChange = async (detail = {}) => {
        homepageCalls.push(detail);
        return true;
    };
    pointsRuntime.window.handleAdminPointsSiteChange = async (detail = {}) => {
        pointsCalls.push(detail);
        return true;
    };
    growthRuntime.window.handleAdminGrowthCenterSiteChange = async (detail = {}) => {
        growthCalls.push(detail);
        return true;
    };

    const homepageResult = homepageRuntime.window.AdminShell.handleSiteChange({
        site: 'intl',
        writableSite: 'intl',
        isAllSitesSelected: false
    });
    const pointsResult = pointsRuntime.window.AdminShell.handleSiteChange({
        site: 'cn',
        writableSite: 'cn',
        isAllSitesSelected: false
    });
    const growthResult = growthRuntime.window.AdminShell.handleSiteChange({
        site: 'intl',
        writableSite: 'intl',
        isAllSitesSelected: false
    });

    assert.equal(homepageResult, true);
    assert.equal(pointsResult, true);
    assert.equal(growthResult, true);
    assert.equal(homepageCalls.length, 1);
    assert.equal(homepageCalls[0].site, 'intl');
    assert.equal(pointsCalls.length, 1);
    assert.equal(pointsCalls[0].site, 'cn');
    assert.equal(growthCalls.length, 1);
    assert.equal(growthCalls[0].site, 'intl');
});

test('admin shell default site-change fallback refreshes analytics containers through the shared analytics helper', async () => {
    const overviewRuntime = loadAdminShellRuntime({ activeModuleId: 'business-overview' });
    const commerceRuntime = loadAdminShellRuntime({ activeModuleId: 'commerce-center' });
    const analyticsCalls = [];

    overviewRuntime.window.handleAdminAnalyticsSiteChange = async (detail = {}) => {
        analyticsCalls.push({ moduleId: 'business-overview', detail });
        return true;
    };
    commerceRuntime.window.handleAdminAnalyticsSiteChange = async (detail = {}) => {
        analyticsCalls.push({ moduleId: 'commerce-center', detail });
        return true;
    };

    const overviewResult = overviewRuntime.window.AdminShell.handleSiteChange({
        site: 'intl',
        writableSite: 'intl',
        isAllSitesSelected: false
    });
    const commerceResult = commerceRuntime.window.AdminShell.handleSiteChange({
        site: 'cn',
        writableSite: 'cn',
        isAllSitesSelected: false
    });

    assert.equal(overviewResult, true);
    assert.equal(commerceResult, true);
    assert.equal(analyticsCalls.length, 2);
    assert.equal(analyticsCalls[0].detail.activeModuleId, 'business-overview');
    assert.equal(analyticsCalls[0].detail.site, 'intl');
    assert.equal(analyticsCalls[1].detail.activeModuleId, 'commerce-center');
    assert.equal(analyticsCalls[1].detail.site, 'cn');
});

test('admin shell default site-change fallback refreshes comments, gallery, shop, payments, and tickets through exported helpers', async () => {
    const commentsRuntime = loadAdminShellRuntime({ activeModuleId: 'comments' });
    const galleryRuntime = loadAdminShellRuntime({ activeModuleId: 'gallery' });
    const shopRuntime = loadAdminShellRuntime({ activeModuleId: 'shop' });
    const paymentsRuntime = loadAdminShellRuntime({ activeModuleId: 'payments' });
    const ticketsRuntime = loadAdminShellRuntime({ activeModuleId: 'tickets' });
    const commentsCalls = [];
    const galleryCalls = [];
    const shopCalls = [];
    const paymentsCalls = [];
    const ticketsCalls = [];

    commentsRuntime.window.handleAdminCommentsSiteChange = async (detail = {}) => {
        commentsCalls.push(detail);
        return true;
    };
    galleryRuntime.window.handleAdminGallerySiteChange = async (detail = {}) => {
        galleryCalls.push(detail);
        return true;
    };
    shopRuntime.window.handleAdminShopSiteChange = async (detail = {}) => {
        shopCalls.push(detail);
        return true;
    };
    paymentsRuntime.window.handleAdminPaymentsSiteChange = async (detail = {}) => {
        paymentsCalls.push(detail);
        return true;
    };
    ticketsRuntime.window.handleAdminTicketsSiteChange = async (detail = {}) => {
        ticketsCalls.push(detail);
        return true;
    };

    assert.equal(commentsRuntime.window.AdminShell.handleSiteChange({ site: 'intl' }), true);
    assert.equal(galleryRuntime.window.AdminShell.handleSiteChange({ site: 'cn' }), true);
    assert.equal(shopRuntime.window.AdminShell.handleSiteChange({ site: 'intl' }), true);
    assert.equal(paymentsRuntime.window.AdminShell.handleSiteChange({ site: 'cn' }), true);
    assert.equal(ticketsRuntime.window.AdminShell.handleSiteChange({ site: 'intl' }), true);

    assert.equal(commentsCalls.length, 1);
    assert.equal(commentsCalls[0].site, 'intl');
    assert.equal(galleryCalls.length, 1);
    assert.equal(galleryCalls[0].site, 'cn');
    assert.equal(shopCalls.length, 1);
    assert.equal(shopCalls[0].site, 'intl');
    assert.equal(paymentsCalls.length, 1);
    assert.equal(paymentsCalls[0].site, 'cn');
    assert.equal(ticketsCalls.length, 1);
    assert.equal(ticketsCalls[0].site, 'intl');
});

test('admin shell default site-change fallback refreshes settings and ops alerts through exported helpers', async () => {
    const settingsRuntime = loadAdminShellRuntime({ activeModuleId: 'settings' });
    const opsAlertsRuntime = loadAdminShellRuntime({ activeModuleId: 'ops-alerts' });
    const settingsCalls = [];
    const opsAlertsCalls = [];

    settingsRuntime.window.handleAdminSettingsSiteChange = async (detail = {}) => {
        settingsCalls.push(detail);
        return true;
    };
    opsAlertsRuntime.window.handleAdminOpsAlertsSiteChange = async (detail = {}) => {
        opsAlertsCalls.push(detail);
        return true;
    };

    const settingsResult = settingsRuntime.window.AdminShell.handleSiteChange({
        site: 'intl',
        writableSite: 'intl',
        isAllSitesSelected: false
    });
    const opsAlertsResult = opsAlertsRuntime.window.AdminShell.handleSiteChange({
        site: 'cn',
        writableSite: 'cn',
        isAllSitesSelected: false
    });

    assert.equal(settingsResult, true);
    assert.equal(opsAlertsResult, true);
    assert.equal(settingsCalls.length, 1);
    assert.equal(settingsCalls[0].site, 'intl');
    assert.equal(opsAlertsCalls.length, 1);
    assert.equal(opsAlertsCalls[0].site, 'cn');
});
