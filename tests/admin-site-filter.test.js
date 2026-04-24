const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const siteFilterPath = path.resolve(__dirname, '../js/admin-site-filter.js');
const adminStudioPath = path.resolve(__dirname, '../admin-studio.js');
const adminStudioBootstrapPath = path.resolve(__dirname, '../js/admin-studio-bootstrap.js');

function loadAdminSiteFilter(options = {}) {
    const script = fs.readFileSync(siteFilterPath, 'utf8');
    const storage = new Map(Object.entries(options.localStorage || {}));
    const toasts = [];
    const dispatchedEvents = [];
    const analyticsReloads = [];
    const usersReloads = [];
    const paymentsReloads = [];
    const shopSiteChangeCalls = [];
    const paymentsSiteChangeCalls = [];
    const shellSiteChanges = [];
    const chatSiteChangeCalls = [];
    const usersSiteChangeCalls = [];
    const commentsSiteChangeCalls = [];
    const homepageSiteChangeCalls = [];
    const pointsSiteChangeCalls = [];
    const growthCenterSiteChangeCalls = [];
    const analyticsSiteChangeCalls = [];
    const settingsSiteChangeCalls = [];
    const discountsSiteChangeCalls = [];
    const opsAlertsSiteChangeCalls = [];
    const pointsBatchReloads = [];
    const activeModuleId = String(options.activeModuleId || '').trim();
    const context = {
        console: {
            log() {},
            warn() {}
        },
        localStorage: {
            getItem(key) {
                return storage.has(key) ? storage.get(key) : null;
            },
            setItem(key, value) {
                storage.set(key, String(value));
            }
        },
        document: {
            addEventListener() {},
            getElementById() {
                return null;
            },
            querySelector(selector) {
                if (activeModuleId && selector === '.module-container.active') {
                    return {
                        id: `module-${activeModuleId}`
                    };
                }
                return null;
            },
            querySelectorAll() {
                return [];
            }
        },
        CustomEvent: function CustomEvent(type, init) {
            this.type = type;
            this.detail = init?.detail;
        }
    };

    context.window = {
        showToast(message, type) {
            toasts.push({ message, type });
        },
        dispatchEvent(event) {
            dispatchedEvents.push(event);
        },
        reloadAnalyticsDashboard(payload) {
            analyticsReloads.push(payload || null);
        },
        loadUsers() {
            usersReloads.push(true);
        },
        loadBatches() {
            pointsBatchReloads.push(true);
        },
        AdminPayments: {
            reload() {
                paymentsReloads.push(true);
            }
        }
    };
    if (options.withChatSiteChangeHelper) {
        context.window.handleAdminChatModuleSiteChange = async () => {
            chatSiteChangeCalls.push(true);
            return true;
        };
    }
    if (options.withUsersSiteChangeHelper) {
        context.window.handleAdminUsersSiteChange = async () => {
            usersSiteChangeCalls.push(true);
            return true;
        };
    }
    if (options.withCommentsSiteChangeHelper) {
        context.window.handleAdminCommentsSiteChange = async () => {
            commentsSiteChangeCalls.push(true);
            return true;
        };
    }
    if (options.withHomepageSiteChangeHelper) {
        context.window.handleAdminHomepageSiteChange = async (detail = {}) => {
            homepageSiteChangeCalls.push(detail);
            return true;
        };
    }
    if (options.withPointsSiteChangeHelper) {
        context.window.handleAdminPointsSiteChange = async (detail = {}) => {
            pointsSiteChangeCalls.push(detail);
            return true;
        };
    }
    if (options.withGrowthCenterSiteChangeHelper) {
        context.window.handleAdminGrowthCenterSiteChange = async (detail = {}) => {
            growthCenterSiteChangeCalls.push(detail);
            return true;
        };
    }
    if (options.withAnalyticsSiteChangeHelper) {
        context.window.handleAdminAnalyticsSiteChange = async (detail = {}) => {
            analyticsSiteChangeCalls.push(detail);
            return true;
        };
    }
    if (options.withSettingsSiteChangeHelper) {
        context.window.handleAdminSettingsSiteChange = async (detail = {}) => {
            settingsSiteChangeCalls.push(detail);
            return true;
        };
    }
    if (options.withDiscountsSiteChangeHelper) {
        context.window.handleAdminDiscountsSiteChange = async (detail = {}) => {
            discountsSiteChangeCalls.push(detail);
            return true;
        };
    }
    if (options.withOpsAlertsSiteChangeHelper) {
        context.window.handleAdminOpsAlertsSiteChange = async (detail = {}) => {
            opsAlertsSiteChangeCalls.push(detail);
            return true;
        };
    }
    if (options.withShopSiteChangeHelper) {
        context.window.handleAdminShopSiteChange = async (detail = {}) => {
            shopSiteChangeCalls.push(detail);
            return true;
        };
    }
    if (options.withPaymentsSiteChangeHelper) {
        context.window.handleAdminPaymentsSiteChange = async (detail = {}) => {
            paymentsSiteChangeCalls.push(detail);
            return true;
        };
    }
    if (options.withAdminShell) {
        context.window.AdminShell = {
            handleSiteChange(detail) {
                shellSiteChanges.push(detail);
                return true;
            }
        };
    }
    context.globalThis = context.window;

    vm.runInNewContext(script, context);

    return {
        AdminSiteFilter: context.window.AdminSiteFilter,
        storage,
        toasts,
        dispatchedEvents,
        analyticsReloads,
        usersReloads,
        paymentsReloads,
        shopSiteChangeCalls,
        paymentsSiteChangeCalls,
        shellSiteChanges,
        chatSiteChangeCalls,
        usersSiteChangeCalls,
        commentsSiteChangeCalls,
        homepageSiteChangeCalls,
        pointsSiteChangeCalls,
        growthCenterSiteChangeCalls,
        analyticsSiteChangeCalls,
        settingsSiteChangeCalls,
        discountsSiteChangeCalls,
        opsAlertsSiteChangeCalls,
        pointsBatchReloads
    };
}

test('admin site filter normalizes invalid stored values to all and exposes writable helpers', () => {
    const { AdminSiteFilter, storage } = loadAdminSiteFilter({
        localStorage: {
            admin_site_filter: 'legacy-site'
        }
    });

    assert.equal(AdminSiteFilter.getSiteFilter(), 'all');
    assert.equal(AdminSiteFilter.isAllSitesSelected(), true);
    assert.equal(AdminSiteFilter.getWritableSite(), null);
    assert.equal(AdminSiteFilter.actionRequiresWritableSite('homepage-save-section'), true);
    assert.equal(AdminSiteFilter.actionRequiresWritableSite('switch-module'), false);
    assert.equal(AdminSiteFilter.formRequiresWritableSite('promptForm'), true);
    assert.equal(AdminSiteFilter.formRequiresWritableSite('ticketReplyForm'), false);
    assert.equal(storage.get('admin_site_filter'), 'legacy-site');
});

test('admin site filter requireWritableSite warns in all mode and resolves when a writable site is selected', () => {
    const { AdminSiteFilter, toasts, dispatchedEvents, storage } = loadAdminSiteFilter({
        localStorage: {
            admin_site_filter: 'all'
        }
    });

    assert.equal(AdminSiteFilter.requireWritableSite({ action: 'homepage-save-section' }), null);
    assert.equal(toasts.length, 1);
    assert.equal(toasts[0].type, 'warning');
    assert.match(toasts[0].message, /请先选择 CN 或 EN 站点/);
    assert.match(toasts[0].message, /保存首页分区/);

    AdminSiteFilter.select('cn');

    assert.equal(AdminSiteFilter.getSiteFilter(), 'cn');
    assert.equal(AdminSiteFilter.isAllSitesSelected(), false);
    assert.equal(AdminSiteFilter.getWritableSite(), 'cn');
    assert.equal(AdminSiteFilter.requireWritableSite({ formId: 'promptForm' }), 'cn');
    assert.equal(storage.get('admin_site_filter'), 'cn');
    assert.equal(dispatchedEvents.length, 1);
    assert.equal(dispatchedEvents[0].type, 'admin-site-changed');
    assert.deepEqual(JSON.parse(JSON.stringify(dispatchedEvents[0].detail)), {
        site: 'cn',
        writableSite: 'cn',
        isAllSitesSelected: false
    });
});

test('admin site filter reloads analytics aliases through the shared analytics dashboard refresher', () => {
    const analyticsAliases = ['analytics', 'business-overview', 'commerce-center'];

    analyticsAliases.forEach((activeModuleId) => {
        const { AdminSiteFilter, analyticsReloads, usersReloads, paymentsReloads } = loadAdminSiteFilter({
            activeModuleId,
            localStorage: {
                admin_site_filter: 'all'
            }
        });

        AdminSiteFilter.select('intl');

        assert.equal(analyticsReloads.length, 1, `${activeModuleId} should trigger one analytics reload on site change`);
        assert.deepEqual(JSON.parse(JSON.stringify(analyticsReloads[0])), { reason: 'site-change' });
        assert.equal(usersReloads.length, 0, `${activeModuleId} should not trigger user reloads`);
        assert.equal(paymentsReloads.length, 0, `${activeModuleId} should not trigger payment reloads`);
    });
});

test('admin site filter refreshes analytics containers through the shared analytics site-change helper in legacy fallback mode', () => {
    const overviewRuntime = loadAdminSiteFilter({
        activeModuleId: 'business-overview',
        withAnalyticsSiteChangeHelper: true,
        localStorage: {
            admin_site_filter: 'all'
        }
    });
    const commerceRuntime = loadAdminSiteFilter({
        activeModuleId: 'commerce-center',
        withAnalyticsSiteChangeHelper: true,
        localStorage: {
            admin_site_filter: 'all'
        }
    });

    overviewRuntime.AdminSiteFilter.select('intl');
    commerceRuntime.AdminSiteFilter.select('cn');

    assert.equal(overviewRuntime.analyticsSiteChangeCalls.length, 1);
    assert.equal(overviewRuntime.analyticsSiteChangeCalls[0].activeModuleId, 'business-overview');
    assert.equal(overviewRuntime.analyticsSiteChangeCalls[0].site, 'intl');
    assert.equal(overviewRuntime.analyticsReloads.length, 0);
    assert.equal(commerceRuntime.analyticsSiteChangeCalls.length, 1);
    assert.equal(commerceRuntime.analyticsSiteChangeCalls[0].activeModuleId, 'commerce-center');
    assert.equal(commerceRuntime.analyticsSiteChangeCalls[0].site, 'cn');
    assert.equal(commerceRuntime.analyticsReloads.length, 0);
});

test('admin site filter delegates site reloads to the admin shell when available', () => {
    const { AdminSiteFilter, analyticsReloads, usersReloads, paymentsReloads, shellSiteChanges } = loadAdminSiteFilter({
        activeModuleId: 'users',
        withAdminShell: true,
        localStorage: {
            admin_site_filter: 'all'
        }
    });

    AdminSiteFilter.select('intl');

    assert.equal(shellSiteChanges.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(shellSiteChanges[0])), {
        site: 'intl',
        writableSite: 'intl',
        isAllSitesSelected: false
    });
    assert.equal(analyticsReloads.length, 0);
    assert.equal(usersReloads.length, 0);
    assert.equal(paymentsReloads.length, 0);
});

test('admin site filter refreshes chat through the shared chat site-change helper in legacy fallback mode', () => {
    const { AdminSiteFilter, chatSiteChangeCalls } = loadAdminSiteFilter({
        activeModuleId: 'chat',
        withChatSiteChangeHelper: true,
        localStorage: {
            admin_site_filter: 'all'
        }
    });

    AdminSiteFilter.select('intl');

    assert.equal(chatSiteChangeCalls.length, 1);
});

test('admin site filter refreshes users through the shared users site-change helper in legacy fallback mode', () => {
    const { AdminSiteFilter, usersSiteChangeCalls, usersReloads } = loadAdminSiteFilter({
        activeModuleId: 'users',
        withUsersSiteChangeHelper: true,
        localStorage: {
            admin_site_filter: 'all'
        }
    });

    AdminSiteFilter.select('intl');

    assert.equal(usersSiteChangeCalls.length, 1);
    assert.equal(usersReloads.length, 0);
});

test('admin site filter refreshes comments through the shared comments site-change helper in legacy fallback mode', () => {
    const { AdminSiteFilter, commentsSiteChangeCalls } = loadAdminSiteFilter({
        activeModuleId: 'comments',
        withCommentsSiteChangeHelper: true,
        localStorage: {
            admin_site_filter: 'all'
        }
    });

    AdminSiteFilter.select('intl');

    assert.equal(commentsSiteChangeCalls.length, 1);
});

test('admin site filter refreshes homepage, points, and growth center through shared site-change helpers in legacy fallback mode', () => {
    const homepageRuntime = loadAdminSiteFilter({
        activeModuleId: 'homepage',
        withHomepageSiteChangeHelper: true,
        localStorage: {
            admin_site_filter: 'all'
        }
    });
    const pointsRuntime = loadAdminSiteFilter({
        activeModuleId: 'points',
        withPointsSiteChangeHelper: true,
        localStorage: {
            admin_site_filter: 'all'
        }
    });
    const growthRuntime = loadAdminSiteFilter({
        activeModuleId: 'growth-center',
        withGrowthCenterSiteChangeHelper: true,
        localStorage: {
            admin_site_filter: 'all'
        }
    });

    homepageRuntime.AdminSiteFilter.select('intl');
    pointsRuntime.AdminSiteFilter.select('cn');
    growthRuntime.AdminSiteFilter.select('intl');

    assert.equal(homepageRuntime.homepageSiteChangeCalls.length, 1);
    assert.equal(homepageRuntime.homepageSiteChangeCalls[0].site, 'intl');
    assert.equal(pointsRuntime.pointsSiteChangeCalls.length, 1);
    assert.equal(pointsRuntime.pointsSiteChangeCalls[0].site, 'cn');
    assert.equal(pointsRuntime.pointsBatchReloads.length, 0);
    assert.equal(growthRuntime.growthCenterSiteChangeCalls.length, 1);
    assert.equal(growthRuntime.growthCenterSiteChangeCalls[0].site, 'intl');
    assert.equal(growthRuntime.analyticsReloads.length, 0);
});

test('admin site filter refreshes shop and payments through shared site-change helpers in legacy fallback mode', () => {
    const shopRuntime = loadAdminSiteFilter({
        activeModuleId: 'shop',
        withShopSiteChangeHelper: true,
        localStorage: {
            admin_site_filter: 'all'
        }
    });
    const paymentsRuntime = loadAdminSiteFilter({
        activeModuleId: 'payments',
        withPaymentsSiteChangeHelper: true,
        localStorage: {
            admin_site_filter: 'all'
        }
    });

    shopRuntime.AdminSiteFilter.select('intl');
    paymentsRuntime.AdminSiteFilter.select('cn');

    assert.equal(shopRuntime.shopSiteChangeCalls.length, 1);
    assert.equal(shopRuntime.shopSiteChangeCalls[0].site, 'intl');
    assert.equal(paymentsRuntime.paymentsSiteChangeCalls.length, 1);
    assert.equal(paymentsRuntime.paymentsSiteChangeCalls[0].site, 'cn');
    assert.equal(paymentsRuntime.paymentsReloads.length, 0);
});

test('admin site filter refreshes settings, discounts, and ops alerts through shared site-change helpers in legacy fallback mode', () => {
    const settingsRuntime = loadAdminSiteFilter({
        activeModuleId: 'settings',
        withSettingsSiteChangeHelper: true,
        localStorage: {
            admin_site_filter: 'all'
        }
    });
    const discountsRuntime = loadAdminSiteFilter({
        activeModuleId: 'discounts',
        withDiscountsSiteChangeHelper: true,
        localStorage: {
            admin_site_filter: 'all'
        }
    });
    const opsAlertsRuntime = loadAdminSiteFilter({
        activeModuleId: 'ops-alerts',
        withOpsAlertsSiteChangeHelper: true,
        localStorage: {
            admin_site_filter: 'all'
        }
    });

    settingsRuntime.AdminSiteFilter.select('intl');
    discountsRuntime.AdminSiteFilter.select('intl');
    opsAlertsRuntime.AdminSiteFilter.select('cn');

    assert.equal(settingsRuntime.settingsSiteChangeCalls.length, 1);
    assert.equal(settingsRuntime.settingsSiteChangeCalls[0].site, 'intl');
    assert.equal(discountsRuntime.discountsSiteChangeCalls.length, 1);
    assert.equal(discountsRuntime.discountsSiteChangeCalls[0].site, 'intl');
    assert.equal(opsAlertsRuntime.opsAlertsSiteChangeCalls.length, 1);
    assert.equal(opsAlertsRuntime.opsAlertsSiteChangeCalls[0].site, 'cn');
});

test('admin studio delegated controls and bootstrap use shared writable site guard', () => {
    const adminStudioSource = fs.readFileSync(adminStudioPath, 'utf8');
    const bootstrapSource = fs.readFileSync(adminStudioBootstrapPath, 'utf8');

    assert.equal(
        adminStudioSource.includes('window.AdminSiteFilter?.actionRequiresWritableSite?.(action)'),
        true,
        'admin-studio.js should guard site-sensitive delegated actions'
    );
    assert.equal(
        adminStudioSource.includes('window.AdminSiteFilter?.formRequiresWritableSite?.(formId)'),
        true,
        'admin-studio.js should guard site-sensitive delegated forms'
    );
    assert.equal(
        adminStudioSource.includes("window.AdminSiteFilter?.requireWritableSite?.({ formId: 'promptForm' })"),
        true,
        'admin-studio.js should guard prompt saves through the shared site filter helper'
    );
    assert.equal(
        bootstrapSource.includes('window.AdminSiteFilter?.actionRequiresWritableSite?.(action)'),
        true,
        'js/admin-studio-bootstrap.js should guard fallback click handlers'
    );
    assert.equal(
        bootstrapSource.includes('window.AdminSiteFilter?.formRequiresWritableSite?.(formId)'),
        true,
        'js/admin-studio-bootstrap.js should guard fallback submit handlers'
    );
});
