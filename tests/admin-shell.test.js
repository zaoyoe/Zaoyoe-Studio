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
    assert.equal(receivedContexts[0].focus.ticketId, 'ticket_123');
    assert.equal(events.some((event) => event.type === 'admin-shell-context'), true);
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
