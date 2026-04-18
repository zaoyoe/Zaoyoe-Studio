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
    assert.notEqual(start, -1, `Expected to find ${asyncMarker} or ${plainMarker}`);

    const paramsStart = source.indexOf('(', start);
    assert.notEqual(paramsStart, -1, `Expected to find parameter list for ${functionName}`);

    let paramsDepth = 0;
    let paramsEnd = -1;
    let inSingle = false;
    let inDouble = false;
    let inTemplate = false;
    let escaped = false;

    for (let index = paramsStart; index < source.length; index += 1) {
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

        if (char === '(') {
            paramsDepth += 1;
            continue;
        }

        if (char === ')') {
            paramsDepth -= 1;
            if (paramsDepth === 0) {
                paramsEnd = index;
                break;
            }
        }
    }

    assert.notEqual(paramsEnd, -1, `Expected to find parameter terminator for ${functionName}`);

    const bodyStart = source.indexOf('{', paramsEnd);
    assert.notEqual(bodyStart, -1, `Expected to find function body for ${functionName}`);

    let depth = 0;
    inSingle = false;
    inDouble = false;
    inTemplate = false;
    escaped = false;

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

test('AdminAI.checkHealth preserves existing config on transient gemini health failures', async () => {
    const source = readRepoFile('js/admin-ai.js');
    const context = {
        fetch: async () => ({
            ok: false,
            status: 502,
            async json() {
                return {
                    success: false,
                    message: 'gateway busy'
                };
            }
        }),
        window: {
            ADMIN_AI_SERVICE: 'gemini',
            supabaseClient: {
                auth: {
                    async getSession() {
                        return {
                            data: {
                                session: {
                                    access_token: 'token'
                                }
                            }
                        };
                    }
                }
            }
        }
    };

    vm.runInNewContext(source, context);

    const { AdminAI } = context.window;
    AdminAI.configured = true;
    AdminAI.source = 'stored';

    const error = await AdminAI.checkHealth(true).catch((err) => err);

    assert.equal(error?.message, 'gateway busy');
    assert.equal(error.status, 502);
    assert.equal(AdminAI.configured, true);
    assert.equal(AdminAI.source, 'stored');
});

test('AdminAI.getAuthHeaders falls back to runtime accessToken when sdk session is not ready yet', async () => {
    const source = readRepoFile('js/admin-ai.js');
    const context = {
        window: {
            ADMIN_AI_SERVICE: 'gemini',
            supabaseClient: {
                auth: {
                    async getSession() {
                        return {
                            data: {
                                session: null
                            }
                        };
                    }
                },
                async accessToken() {
                    return 'persisted-access-token';
                }
            }
        }
    };

    vm.runInNewContext(source, context);

    const headers = await context.window.AdminAI.getAuthHeaders();

    assert.equal(headers['Content-Type'], 'application/json');
    assert.equal(headers.Authorization, 'Bearer persisted-access-token');
});

test('checkApiKey keeps existing Gemini source when health probe is temporarily unavailable', async () => {
    const source = readRepoFile('admin-studio.js');
    const helperSource = extractFunction(source, 'getAIHealthFailureStatusText');
    const checkApiKeySource = extractFunction(source, 'checkApiKey');

    const statusCalls = [];
    let renderCalls = 0;
    let analyzeButtonCalls = 0;

    const context = {
        console: {
            warn() {}
        },
        renderApiKeySelector() {
            renderCalls += 1;
        },
        updateAnalyzeButton() {
            analyzeButtonCalls += 1;
        },
        updateStatus(message, state) {
            statusCalls.push({ message, state });
        },
        window: {
            ADMIN_AI_SERVICE: 'gemini',
            GEMINI_API_KEY: '__server_proxy__',
            GEMINI_API_SOURCE: 'stored',
            AdminAI: {
                getPreferredService() {
                    return 'gemini';
                },
                normalizeService(service) {
                    return String(service || '').trim().toLowerCase() || 'gemini';
                },
                getServiceLabel() {
                    return 'Gemini';
                },
                async checkHealth() {
                    const error = new Error('gateway busy');
                    error.status = 502;
                    throw error;
                }
            }
        }
    };

    vm.runInNewContext(`
        ${helperSource}
        ${checkApiKeySource}
        globalThis.checkApiKey = checkApiKey;
    `, context);

    await context.checkApiKey();

    assert.equal(context.window.GEMINI_API_KEY, '__server_proxy__');
    assert.equal(context.window.GEMINI_API_SOURCE, 'stored');
    assert.deepEqual(statusCalls, [{ message: 'Gemini Unavailable', state: 'error' }]);
    assert.equal(renderCalls, 1);
    assert.equal(analyzeButtonCalls, 1);
});
