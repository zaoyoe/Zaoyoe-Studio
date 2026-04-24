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

test('admin studio access gate prefers cached access for the initial unlock and still warms the admin cookie session', async () => {
    const source = readRepoFile('admin-studio.js');
    const functionSource = extractFunction(source, 'requireAdminStudioAccess');
    const gateStates = [];
    const accessCalls = [];
    const sessionCalls = [];
    const appliedAccess = [];

    const context = {
        console: {
            warn() {}
        },
        setTimeout,
        clearTimeout,
        ADMIN_STUDIO_ACCESS_RESTORE_TIMEOUT_MS: 7000,
        ADMIN_STUDIO_ACCESS_GATE_TIMEOUT_MS: 10000,
        renderAdminStudioAccessGate(state, payload = null) {
            gateStates.push({ state, payload });
        },
        applyResolvedAdminAccess(access) {
            appliedAccess.push(access);
        },
        window: {
            setTimeout,
            clearTimeout,
            __adminStudioSessionRestoreReady: Promise.resolve(true),
            supabaseClient: {
                auth: {}
            },
            AdminAccess: {
                async getCurrentAdminAccess(options = {}) {
                    accessCalls.push(options);
                    return {
                        user: { id: 'admin-user-1', email: 'admin@example.com' },
                        isAdmin: true,
                        isSuperAdmin: false,
                        permissions: ['analytics.view'],
                        cached: true
                    };
                },
                async createAdminStudioSession(options = {}) {
                    sessionCalls.push(options);
                    return {
                        ok: true
                    };
                }
            }
        }
    };
    context.globalThis = context;

    vm.runInNewContext(`${functionSource}; globalThis.requireAdminStudioAccess = requireAdminStudioAccess;`, context);

    const access = await context.requireAdminStudioAccess();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(access.isAdmin, true);
    assert.deepEqual(gateStates.map((entry) => entry.state), ['pending', 'granted']);
    assert.equal(accessCalls.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(accessCalls[0])), { forceRefresh: false });
    assert.equal(appliedAccess.length, 1);
    assert.equal(sessionCalls.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(sessionCalls[0])), {
        supabaseClient: context.window.supabaseClient,
        userId: 'admin-user-1',
        forceRefresh: false
    });
    assert.equal(context.window.adminStudioSessionGranted, true);
});

test('admin studio access gate stops waiting and shows retry actions when access lookup hangs', async () => {
    const source = readRepoFile('admin-studio.js');
    const functionSource = extractFunction(source, 'requireAdminStudioAccess');
    const gateStates = [];

    const context = {
        console: {
            warn() {}
        },
        setTimeout,
        clearTimeout,
        ADMIN_STUDIO_ACCESS_RESTORE_TIMEOUT_MS: 20,
        ADMIN_STUDIO_ACCESS_GATE_TIMEOUT_MS: 20,
        renderAdminStudioAccessGate(state, payload = null) {
            gateStates.push({ state, payload });
        },
        applyResolvedAdminAccess() {
            throw new Error('timed out access should not unlock the studio');
        },
        window: {
            __adminStudioAccessGateTimeoutMs: 20,
            __adminStudioSessionRestoreReady: Promise.resolve(true),
            supabaseClient: {
                auth: {}
            },
            AdminAccess: {
                getCurrentAdminAccess() {
                    return new Promise(() => {});
                },
                createAdminStudioSession() {
                    throw new Error('timed out access should not warm a session');
                }
            }
        },
        Error
    };
    context.globalThis = context;
    context.window.setTimeout = setTimeout;
    context.window.clearTimeout = clearTimeout;

    vm.runInNewContext(`${functionSource}; globalThis.requireAdminStudioAccess = requireAdminStudioAccess;`, context);

    const access = await context.requireAdminStudioAccess();

    assert.equal(access, null);
    assert.deepEqual(gateStates.map((entry) => entry.state), ['pending', 'denied']);
    assert.equal(gateStates[1].payload.title, '后台权限校验超时');
    assert.equal(gateStates[1].payload.primaryLabel, '刷新重试');
    assert.equal(gateStates[1].payload.secondaryLabel, '返回首页');
});

test('admin studio access gate retries with force refresh when the cached lookup returns a transient permission error', async () => {
    const source = readRepoFile('admin-studio.js');
    const functionSource = extractFunction(source, 'requireAdminStudioAccess');
    const gateStates = [];
    const accessCalls = [];
    const appliedAccess = [];
    const sessionCalls = [];

    const context = {
        console: {
            warn() {}
        },
        Error,
        Promise,
        setTimeout,
        clearTimeout,
        ADMIN_STUDIO_ACCESS_RESTORE_TIMEOUT_MS: 100,
        ADMIN_STUDIO_ACCESS_GATE_TIMEOUT_MS: 100,
        renderAdminStudioAccessGate(state, payload = null) {
            gateStates.push({ state, payload });
        },
        applyResolvedAdminAccess(access) {
            appliedAccess.push(access);
        },
        window: {
            setTimeout,
            clearTimeout,
            __adminStudioSessionRestoreReady: Promise.resolve({
                restored: true,
                source: 'persisted'
            }),
            supabaseClient: {
                auth: {}
            },
            AdminAccess: {
                async getCurrentAdminAccess(options = {}) {
                    accessCalls.push(options);
                    if (options.forceRefresh === true) {
                        return {
                            user: { id: 'admin-user-1', email: 'admin@example.com' },
                            isAdmin: true,
                            isSuperAdmin: false,
                            permissions: ['analytics.view']
                        };
                    }

                    return {
                        user: { id: 'admin-user-1', email: 'admin@example.com' },
                        isAdmin: false,
                        isSuperAdmin: false,
                        permissions: [],
                        cached: true,
                        error: new Error('rpc unavailable')
                    };
                },
                async createAdminStudioSession(options = {}) {
                    sessionCalls.push(options);
                    return {
                        ok: true
                    };
                }
            }
        }
    };
    context.globalThis = context;

    vm.runInNewContext(`${functionSource}; globalThis.requireAdminStudioAccess = requireAdminStudioAccess;`, context);

    const access = await context.requireAdminStudioAccess();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(access.isAdmin, true);
    assert.deepEqual(gateStates.map((entry) => entry.state), ['pending', 'granted']);
    assert.deepEqual(JSON.parse(JSON.stringify(accessCalls)), [
        { forceRefresh: false },
        { forceRefresh: true }
    ]);
    assert.equal(appliedAccess.length, 1);
    assert.equal(sessionCalls.length, 1);
});

test('admin studio access gate waits briefly for the cookie session and retries in background when the first warmup fails', async () => {
    const source = readRepoFile('admin-studio.js');
    const functionSource = extractFunction(source, 'requireAdminStudioAccess');
    const gateStates = [];
    const sessionCalls = [];
    const appliedAccess = [];

    const context = {
        console: {
            warn() {}
        },
        Error,
        Promise,
        setTimeout,
        clearTimeout,
        ADMIN_STUDIO_ACCESS_RESTORE_TIMEOUT_MS: 100,
        ADMIN_STUDIO_ACCESS_GATE_TIMEOUT_MS: 100,
        ADMIN_STUDIO_SESSION_WARM_TIMEOUT_MS: 60,
        renderAdminStudioAccessGate(state, payload = null) {
            gateStates.push({ state, payload });
        },
        applyResolvedAdminAccess(access) {
            appliedAccess.push(access);
        },
        window: {
            setTimeout,
            clearTimeout,
            __adminStudioSessionRestoreReady: Promise.resolve({
                restored: true,
                source: 'persisted'
            }),
            supabaseClient: {
                auth: {}
            },
            AdminAccess: {
                async getCurrentAdminAccess() {
                    return {
                        user: { id: 'admin-user-1', email: 'admin@example.com' },
                        isAdmin: true,
                        isSuperAdmin: false,
                        permissions: ['analytics.view']
                    };
                },
                async createAdminStudioSession(options = {}) {
                    sessionCalls.push(options);
                    if (options.forceRefresh === true) {
                        return {
                            ok: true
                        };
                    }

                    return {
                        ok: false,
                        reason: 'missing_session'
                    };
                }
            }
        }
    };
    context.globalThis = context;

    vm.runInNewContext(`${functionSource}; globalThis.requireAdminStudioAccess = requireAdminStudioAccess;`, context);

    const access = await context.requireAdminStudioAccess();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(access.isAdmin, true);
    assert.deepEqual(gateStates.map((entry) => entry.state), ['pending', 'granted']);
    assert.equal(appliedAccess.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(sessionCalls)), [
        {
            supabaseClient: context.window.supabaseClient,
            userId: 'admin-user-1',
            forceRefresh: false
        },
        {
            supabaseClient: context.window.supabaseClient,
            userId: 'admin-user-1',
            forceRefresh: true
        }
    ]);
});

test('admin studio access gate does not stay pending when cookie session warmup times out', async () => {
    const source = readRepoFile('admin-studio.js');
    const functionSource = extractFunction(source, 'requireAdminStudioAccess');
    const gateStates = [];
    const sessionCalls = [];

    const context = {
        console: {
            warn() {}
        },
        Error,
        Promise,
        setTimeout,
        clearTimeout,
        ADMIN_STUDIO_ACCESS_RESTORE_TIMEOUT_MS: 100,
        ADMIN_STUDIO_ACCESS_GATE_TIMEOUT_MS: 100,
        ADMIN_STUDIO_SESSION_WARM_TIMEOUT_MS: 20,
        renderAdminStudioAccessGate(state, payload = null) {
            gateStates.push({ state, payload });
        },
        applyResolvedAdminAccess() {},
        window: {
            setTimeout,
            clearTimeout,
            __adminStudioSessionRestoreReady: Promise.resolve({
                restored: true,
                source: 'persisted'
            }),
            supabaseClient: {
                auth: {}
            },
            __adminStudioSessionWarmTimeoutMs: 20,
            AdminAccess: {
                async getCurrentAdminAccess() {
                    return {
                        user: { id: 'admin-user-1', email: 'admin@example.com' },
                        isAdmin: true,
                        isSuperAdmin: false,
                        permissions: ['analytics.view']
                    };
                },
                createAdminStudioSession(options = {}) {
                    sessionCalls.push(options);
                    return new Promise(() => {});
                }
            }
        }
    };
    context.globalThis = context;

    vm.runInNewContext(`${functionSource}; globalThis.requireAdminStudioAccess = requireAdminStudioAccess;`, context);

    const access = await context.requireAdminStudioAccess();

    assert.equal(access.isAdmin, true);
    assert.deepEqual(gateStates.map((entry) => entry.state), ['pending', 'granted']);
    assert.equal(sessionCalls.length >= 1, true);
    assert.equal(context.window.adminStudioSessionGranted, false);
});

test('bootAdminStudio falls back to an actionable error gate when access bootstrap throws unexpectedly', async () => {
    const source = readRepoFile('admin-studio.js');
    const functionSource = extractFunction(source, 'bootAdminStudio');
    const gateStates = [];
    let initializeCalled = false;

    const context = {
        console: {
            error() {}
        },
        renderAdminStudioAccessGate(state, payload = null) {
            gateStates.push({ state, payload });
        },
        async requireAdminStudioAccess() {
            throw new Error('unexpected bootstrap failure');
        },
        async initializeAdminStudioShell() {
            initializeCalled = true;
        },
        window: {
            adminStudioAccessGranted: true
        }
    };
    context.globalThis = context;

    vm.runInNewContext(`${functionSource}; globalThis.bootAdminStudio = bootAdminStudio;`, context);

    await context.bootAdminStudio();

    assert.equal(initializeCalled, false);
    assert.equal(context.window.adminStudioAccessGranted, false);
    assert.deepEqual(gateStates.map((entry) => entry.state), ['denied']);
    assert.equal(gateStates[0].payload.title, '后台初始化失败');
    assert.equal(gateStates[0].payload.primaryLabel, '刷新重试');
});
