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

function createStorage(initialEntries = {}) {
    const state = new Map(Object.entries(initialEntries).map(([key, value]) => [String(key), String(value)]));
    return {
        get length() {
            return state.size;
        },
        key(index) {
            return Array.from(state.keys())[index] || null;
        },
        getItem(key) {
            return state.has(String(key)) ? state.get(String(key)) : null;
        },
        setItem(key, value) {
            state.set(String(key), String(value));
        },
        removeItem(key) {
            state.delete(String(key));
        }
    };
}

test('admin entry stores a fresh post-login return target when the browser is unauthenticated', async () => {
    const source = readRepoFile('js/admin-entry.js');
    const gateStates = [];
    const localStorage = createStorage();

    const context = {
        URL,
        Date,
        console: {
            warn() {},
            error() {}
        },
        setEntryState(state, payload = {}) {
            gateStates.push({ state, payload });
        },
        location: {
            href: 'https://www.zaoyoe.com/admin-entry.html?next=/admin-studio.html'
        },
        localStorage,
        AdminAccess: {
            sanitizeAdminStudioTarget(target) {
                return target === '/admin-studio.html' ? '/admin-studio.html' : 'admin-studio.html';
            },
            async getCurrentAdminAccess() {
                return null;
            },
            async createAdminStudioSession() {
                throw new Error('createAdminStudioSession should not run when access.user is missing');
            }
        }
    };
    context.globalScope = context;
    context.globalThis = context;

    vm.runInNewContext(`
        const POST_LOGIN_REDIRECT_STORAGE_KEY = 'zaoyoe_post_login_redirect_v1';
        const POST_LOGIN_REDIRECT_TTL_MS = 15 * 60 * 1000;
        ${extractFunction(source, 'getSafeTarget')}
        ${extractFunction(source, 'normalizePostLoginRedirectTarget')}
        ${extractFunction(source, 'buildPostLoginRedirectTarget')}
        ${extractFunction(source, 'persistPendingPostLoginRedirectTarget')}
        ${extractFunction(source, 'bootAdminEntry')}
        globalThis.bootAdminEntry = bootAdminEntry;
    `, context);

    await context.bootAdminEntry();

    const storedTarget = JSON.parse(localStorage.getItem('zaoyoe_post_login_redirect_v1'));
    const parsedTarget = new URL(storedTarget.target, 'https://www.zaoyoe.com');

    assert.equal(parsedTarget.pathname, '/admin-entry.html');
    assert.equal(parsedTarget.searchParams.get('next'), '/admin-studio.html');
    assert.equal(gateStates[1].state, 'denied');
    assert.match(gateStates[1].payload.message, /自动返回后台入口/);
});

test('auth callback prefers the pending admin redirect target over the legacy oauth redirect cache', () => {
    const source = readRepoFile('js/auth-callback-page.js');
    const localStorage = createStorage({
        zaoyoe_post_login_redirect_v1: JSON.stringify({
            target: '/admin-entry.html?next=/admin-studio.html',
            savedAt: Date.now(),
            ttlMs: 15 * 60 * 1000
        }),
        oauth_post_login_redirect: '/legacy-path'
    });
    let replacedTarget = null;

    const context = {
        URL,
        Date,
        localStorage,
        window: {
            location: {
                href: 'https://www.zaoyoe.com/auth-callback.html',
                origin: 'https://www.zaoyoe.com',
                replace(target) {
                    replacedTarget = target;
                }
            }
        }
    };
    context.globalThis = context;

    vm.runInNewContext(`
        const POST_LOGIN_REDIRECT_STORAGE_KEY = 'zaoyoe_post_login_redirect_v1';
        const POST_LOGIN_REDIRECT_TTL_MS = 15 * 60 * 1000;
        ${extractFunction(source, 'resolveSafeRedirectTarget')}
        ${extractFunction(source, 'readPendingPostLoginRedirectTarget')}
        ${extractFunction(source, 'consumePendingPostLoginRedirectTarget')}
        ${extractFunction(source, 'redirectBack')}
        globalThis.redirectBack = redirectBack;
    `, context);

    context.redirectBack();

    const parsedTarget = new URL(replacedTarget, 'https://www.zaoyoe.com');
    assert.equal(parsedTarget.pathname, '/admin-entry.html');
    assert.equal(parsedTarget.searchParams.get('next'), '/admin-studio.html');
    assert.equal(localStorage.getItem('zaoyoe_post_login_redirect_v1'), null);
    assert.equal(localStorage.getItem('oauth_post_login_redirect'), null);
});

test('auth runtime consumes a fresh pending admin redirect target and navigates back immediately after login', () => {
    const source = readRepoFile('supabase-auth-functions.js');
    const localStorage = createStorage({
        zaoyoe_post_login_redirect_v1: JSON.stringify({
            target: '/admin-entry.html?next=/admin-studio.html',
            savedAt: Date.now(),
            ttlMs: 15 * 60 * 1000
        })
    });
    let replacedTarget = null;

    const context = {
        URL,
        Date,
        localStorage,
        console: {
            warn() {}
        },
        window: {
            location: {
                href: 'https://www.zaoyoe.com/',
                origin: 'https://www.zaoyoe.com',
                replace(target) {
                    replacedTarget = target;
                }
            }
        }
    };
    context.globalThis = context;

    vm.runInNewContext(`
        const POST_LOGIN_REDIRECT_STORAGE_KEY = 'zaoyoe_post_login_redirect_v1';
        const POST_LOGIN_REDIRECT_TTL_MS = 15 * 60 * 1000;
        ${extractFunction(source, 'normalizePostLoginRedirectTarget')}
        ${extractFunction(source, 'readPendingPostLoginRedirectTarget')}
        ${extractFunction(source, 'consumePendingPostLoginRedirectTarget')}
        ${extractFunction(source, 'redirectToPendingPostLoginTarget')}
        globalThis.redirectToPendingPostLoginTarget = redirectToPendingPostLoginTarget;
    `, context);

    const redirected = context.redirectToPendingPostLoginTarget();
    const parsedTarget = new URL(replacedTarget, 'https://www.zaoyoe.com');

    assert.equal(redirected, true);
    assert.equal(parsedTarget.pathname, '/admin-entry.html');
    assert.equal(parsedTarget.searchParams.get('next'), '/admin-studio.html');
    assert.equal(localStorage.getItem('zaoyoe_post_login_redirect_v1'), null);
});

test('auth runtime wires post-login redirects into both popup and inline success paths', () => {
    const source = readRepoFile('supabase-auth-functions.js');
    const redirectMarkers = source.match(/if \(redirectToPendingPostLoginTarget\(\)\) \{/g) || [];

    assert.equal(redirectMarkers.length >= 2, true, 'supabase-auth-functions.js should redirect after both popup and inline login success flows');
    assert.equal(source.includes('storePendingPostLoginRedirectTarget(currentPage);'), true, 'OAuth redirect fallback should also seed the shared post-login redirect cache');
});
