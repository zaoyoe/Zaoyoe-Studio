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

function extractObjectFunctionExpression(source, propertyName) {
    const marker = `${propertyName}: async function`;
    const start = source.indexOf(marker);
    assert.notEqual(start, -1, `Expected to find property ${propertyName}`);

    const functionStart = source.indexOf('async function', start);
    const paramsStart = source.indexOf('(', functionStart);
    const bodyStart = source.indexOf('{', paramsStart);
    assert.notEqual(functionStart, -1, `Expected function expression for ${propertyName}`);
    assert.notEqual(paramsStart, -1, `Expected parameter list for ${propertyName}`);
    assert.notEqual(bodyStart, -1, `Expected function body for ${propertyName}`);

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
                return source.slice(functionStart, index + 1);
            }
        }
    }

    throw new Error(`Failed to extract property function ${propertyName}`);
}

function extractObjectMethod(source, methodName) {
    const marker = `async ${methodName}(`;
    const start = source.indexOf(marker);
    assert.notEqual(start, -1, `Expected to find method ${methodName}`);

    const paramsStart = source.indexOf('(', start);
    const bodyStart = source.indexOf('{', paramsStart);
    assert.notEqual(paramsStart, -1, `Expected parameter list for ${methodName}`);
    assert.notEqual(bodyStart, -1, `Expected method body for ${methodName}`);

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

    throw new Error(`Failed to extract method ${methodName}`);
}

test('analytics admin auth headers reuse AdminApi request init before reading sdk session directly', async () => {
    const source = readRepoFile('admin-analytics.js');
    const functionSource = extractFunction(source, 'getAnalyticsAdminAuthHeaders');
    const context = {
        window: {
            AdminAI: null,
            AdminApi: {
                async buildRequestInit(init = {}) {
                    return {
                        headers: {
                            ...init.headers,
                            Authorization: 'Bearer runtime-token'
                        }
                    };
                }
            },
            supabaseClient: {
                auth: {
                    async getSession() {
                        throw new Error('getSession should not run when AdminApi.buildRequestInit succeeds');
                    }
                }
            }
        }
    };
    context.globalThis = context;

    vm.runInNewContext(`${functionSource}; globalThis.getAnalyticsAdminAuthHeaders = getAnalyticsAdminAuthHeaders;`, context);
    const headers = await context.getAnalyticsAdminAuthHeaders();

    assert.equal(headers.Authorization, 'Bearer runtime-token');
    assert.equal(headers['Content-Type'], 'application/json');
});

test('shop admin auth headers fall back to runtime accessToken when sdk session is not ready', async () => {
    const source = readRepoFile('js/admin-shop.js');
    const functionSource = extractObjectFunctionExpression(source, 'getAdminAuthHeaders');
    const context = {
        window: {
            AdminAI: null,
            AdminApi: null,
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
                    return 'shop-runtime-token';
                }
            }
        }
    };
    context.globalThis = context;

    vm.runInNewContext(`globalThis.getAdminAuthHeaders = ${functionSource};`, context);
    const headers = await context.getAdminAuthHeaders();

    assert.equal(headers.Authorization, 'Bearer shop-runtime-token');
    assert.equal(headers['Content-Type'], 'application/json');
});

test('tickets admin auth headers fall back to runtime accessToken when sdk session is not ready', async () => {
    const source = readRepoFile('js/admin-tickets.js');
    const functionSource = extractObjectFunctionExpression(source, 'getAdminAuthHeaders');
    const context = {
        window: {
            AdminAI: null,
            AdminApi: null,
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
                    return 'tickets-runtime-token';
                }
            }
        }
    };
    context.globalThis = context;

    vm.runInNewContext(`globalThis.getAdminAuthHeaders = ${functionSource};`, context);
    const headers = await context.getAdminAuthHeaders();

    assert.equal(headers.Authorization, 'Bearer tickets-runtime-token');
    assert.equal(headers['Content-Type'], 'application/json');
});

test('chat ops alert auth headers fall back to the runtime accessToken when sdk session is not ready', async () => {
    const source = readRepoFile('js/admin-chat.js');
    const methodSource = extractObjectMethod(source, 'getOpsAlertCaseApiHeaders');
    const context = {
        window: {
            AdminApi: null
        }
    };
    context.globalThis = context;

    vm.runInNewContext(`globalThis.getOpsAlertCaseApiHeaders = ({ ${methodSource} }).getOpsAlertCaseApiHeaders;`, context);
    const headers = await context.getOpsAlertCaseApiHeaders.call({
        supabase: {
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
                return 'chat-runtime-token';
            }
        }
    });

    assert.equal(headers.Authorization, 'Bearer chat-runtime-token');
    assert.equal(headers['Content-Type'], 'application/json');
});
