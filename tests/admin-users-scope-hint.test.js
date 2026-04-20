const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

function extractFunction(source, functionName) {
    const asyncMarker = `async function ${functionName}(`;
    const plainMarker = `function ${functionName}(`;
    const start = source.indexOf(asyncMarker) !== -1
        ? source.indexOf(asyncMarker)
        : source.indexOf(plainMarker);

    assert.notEqual(start, -1, `Expected to find ${functionName}`);

    const paramsStart = source.indexOf('(', start);
    const bodyStart = source.indexOf('{', paramsStart);
    assert.notEqual(paramsStart, -1, `Expected parameter list for ${functionName}`);
    assert.notEqual(bodyStart, -1, `Expected function body for ${functionName}`);

    let depth = 0;
    let inSingle = false;
    let inDouble = false;
    let inTemplate = false;
    let escaped = false;

    for (let index = bodyStart; index < source.length; index += 1) {
        const char = source[index];

        if (escaped) {
            escaped = false;
            continue;
        }

        if (char === '\\') {
            escaped = true;
            continue;
        }

        if (inSingle) {
            if (char === '\'') inSingle = false;
            continue;
        }

        if (inDouble) {
            if (char === '"') inDouble = false;
            continue;
        }

        if (inTemplate) {
            if (char === '`') inTemplate = false;
            continue;
        }

        if (char === '\'') {
            inSingle = true;
            continue;
        }

        if (char === '"') {
            inDouble = true;
            continue;
        }

        if (char === '`') {
            inTemplate = true;
            continue;
        }

        if (char === '{') {
            depth += 1;
            continue;
        }

        if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return source.slice(start, index + 1);
            }
        }
    }

    throw new Error(`Failed to extract function ${functionName}`);
}

test('users module exposes a dedicated scope hint container above the directory table', () => {
    const html = readRepoFile('admin-studio.html');
    const css = readRepoFile('admin-studio.css');
    const moduleStart = html.indexOf('<div id="module-users" class="module-container">');
    const hintIndex = html.indexOf('id="usersScopeHint"', moduleStart);
    const tableIndex = html.indexOf('<div class="glass-panel table-view users-table-panel">', moduleStart);

    assert.notEqual(moduleStart, -1, 'Expected the users module container');
    assert.notEqual(hintIndex, -1, 'Expected a users scope hint container');
    assert.notEqual(tableIndex, -1, 'Expected the users table panel');
    assert.equal(hintIndex < tableIndex, true, 'Scope hint should render before the users table');
    assert.equal(html.includes('class="admin-users-scope-hint"'), true);
    assert.equal(html.includes('aria-live="polite"'), true);
    assert.equal(css.includes('#module-users .admin-users-scope-hint'), true, 'Expected dedicated users scope hint styles');
});

test('renderUsersScopeHint only shows the activity-based audit note for site-specific views', () => {
    const source = readRepoFile('admin-users.js');
    const functionSource = extractFunction(source, 'renderUsersScopeHint');
    let currentSite = 'cn';
    const hintEl = {
        hidden: true,
        innerHTML: ''
    };

    const context = {
        document: {
            getElementById(id) {
                return id === 'usersScopeHint' ? hintEl : null;
            }
        },
        window: {
            AdminSiteFilter: {
                getSiteFilter() {
                    return currentSite;
                }
            }
        },
        getUsersAuditSite() {
            return context.window.AdminSiteFilter.getSiteFilter();
        },
        escapeHtml(value) {
            return String(value || '')
                .replaceAll('&', '&amp;')
                .replaceAll('<', '&lt;')
                .replaceAll('>', '&gt;')
                .replaceAll('"', '&quot;')
                .replaceAll('\'', '&#39;');
        }
    };
    context.globalThis = context;

    vm.runInNewContext(`${functionSource}; globalThis.renderUsersScopeHint = renderUsersScopeHint;`, context);

    context.renderUsersScopeHint();
    assert.equal(hintEl.hidden, false);
    assert.match(hintEl.innerHTML, /CN/);
    assert.match(hintEl.innerHTML, /登录、评论、留言或积分/);
    assert.match(hintEl.innerHTML, /不代表完整注册用户名册/);
    assert.match(hintEl.innerHTML, /🌐 全部/);

    currentSite = 'all';
    context.renderUsersScopeHint();
    assert.equal(hintEl.hidden, true);
    assert.equal(hintEl.innerHTML, '');
});

test('users scope hint is refreshed from both control sync and list loading flows', () => {
    const source = readRepoFile('admin-users.js');
    const syncSource = extractFunction(source, 'syncUserModuleControls');
    const loadUsersStart = source.indexOf('async function loadUsers(options = {}) {');
    const loadUsersPrefix = loadUsersStart === -1
        ? ''
        : source.slice(loadUsersStart, loadUsersStart + 220);

    assert.equal(syncSource.includes('renderUsersScopeHint();'), true, 'syncUserModuleControls should refresh the scope hint');
    assert.notEqual(loadUsersStart, -1, 'Expected to find loadUsers');
    assert.equal(loadUsersPrefix.includes('renderUsersScopeHint();'), true, 'loadUsers should refresh the scope hint before fetching data');
});
