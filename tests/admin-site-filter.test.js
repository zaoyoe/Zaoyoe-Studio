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
    const shellSiteChanges = [];
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
        AdminPayments: {
            reload() {
                paymentsReloads.push(true);
            }
        }
    };
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
        shellSiteChanges
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
    const analyticsAliases = ['analytics', 'business-overview', 'growth-center', 'commerce-center'];

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
