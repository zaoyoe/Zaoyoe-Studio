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
        renderAdminStudioAccessGate(state, payload = null) {
            gateStates.push({ state, payload });
        },
        applyResolvedAdminAccess(access) {
            appliedAccess.push(access);
        },
        window: {
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

    assert.equal(access.isAdmin, true);
    assert.deepEqual(gateStates.map((entry) => entry.state), ['pending', 'granted']);
    assert.equal(accessCalls.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(accessCalls[0])), { forceRefresh: false });
    assert.equal(appliedAccess.length, 1);
    assert.equal(sessionCalls.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(sessionCalls[0])), {
        supabaseClient: context.window.supabaseClient,
        userId: 'admin-user-1'
    });
    assert.equal(context.window.adminStudioSessionGranted, true);
});
