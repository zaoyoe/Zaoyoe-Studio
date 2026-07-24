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

test('AdminAI.generateText sends compact token budget metadata to Codex relay', async () => {
    const source = readRepoFile('js/admin-ai.js');
    const fetchCalls = [];
    const events = [];
    const context = {
        performance: {
            now() {
                return 100;
            }
        },
        CustomEvent: function CustomEvent(type, init) {
            this.type = type;
            this.detail = init?.detail;
        },
        fetch: async (input, init = {}) => {
            fetchCalls.push({ input, init });
            return {
                ok: true,
                status: 200,
                async text() {
                    return JSON.stringify({
                        success: true,
                        model: 'gpt-5.4',
                        apiFormat: 'responses',
                        text: 'ok',
                        budget: {
                            tier: 'lean',
                            inputChars: 40,
                            estimatedInputTokens: 10
                        }
                    });
                }
            };
        },
        window: {
            ADMIN_AI_SERVICE: 'codex',
            dispatchEvent(event) {
                events.push(event);
            },
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

    const text = await context.window.AdminAI.generateText('x'.repeat(1200), {
        model: 'gpt-5.4',
        budget: {
            tier: 'lean',
            maxInputChars: 1000,
            maxOutputTokens: 120
        }
    });

    assert.equal(text, 'ok');
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].input, '/api/admin?route=codex');

    const body = JSON.parse(fetchCalls[0].init.body);
    assert.equal(body.prompt, '');
    assert.equal(body.contents[0].parts[0].text, 'x'.repeat(1000));
    assert.deepEqual(body.budget, {
        tier: 'lean',
        maxInputChars: 1000,
        maxOutputTokens: 120
    });
    assert.equal(body.generationConfig.maxOutputTokens, 120);
    assert.equal(events.some((event) => event.type === 'admin-ai-budget'), true);
    assert.equal(events.some((event) => event.type === 'admin-ai-response' && event.detail.ok === true), true);
});

test('AdminAI.generateText requires an explicit budget tier before sending admin relay requests', async () => {
    const source = readRepoFile('js/admin-ai.js');
    const fetchCalls = [];
    const context = {
        fetch: async (input, init = {}) => {
            fetchCalls.push({ input, init });
            return {
                ok: true,
                status: 200,
                async text() {
                    return JSON.stringify({
                        success: true,
                        text: 'ok'
                    });
                }
            };
        },
        window: {
            ADMIN_AI_SERVICE: 'codex',
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

    const error = await context.window.AdminAI.generateText('missing budget', {
        model: 'gpt-5.4'
    }).catch((err) => err);

    assert.equal(error?.code, 'ADMIN_AI_BUDGET_REQUIRED');
    assert.match(error?.message || '', /budget tier is required/i);
    assert.equal(fetchCalls.length, 0);
});

test('AdminAI.generateText exposes upstream retry timing for recoverable rate limits', async () => {
    const source = readRepoFile('js/admin-ai.js');
    const events = [];
    const context = {
        performance: {
            now() {
                return 100;
            }
        },
        CustomEvent: function CustomEvent(type, init) {
            this.type = type;
            this.detail = init?.detail;
        },
        fetch: async () => ({
            ok: false,
            status: 429,
            headers: {
                get(name) {
                    return String(name).toLowerCase() === 'retry-after' ? '12' : '';
                }
            },
            async text() {
                return JSON.stringify({
                    success: false,
                    message: 'Resource exhausted'
                });
            }
        }),
        window: {
            ADMIN_AI_SERVICE: 'gemini',
            dispatchEvent(event) {
                events.push(event);
            },
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

    const error = await context.window.AdminAI.generateText('translate this', {
        budget: { tier: 'longform' }
    }).catch((caught) => caught);

    assert.equal(error.status, 429);
    assert.equal(error.isRateLimited, true);
    assert.equal(error.retryAfterMs, 12000);
    assert.equal(events.some((event) => event.type === 'admin-ai-response'
        && event.detail.ok === false
        && event.detail.retryAfterMs === 12000), true);
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

test('initializeAdminStudioShell warms saved AI service before first health check', async () => {
    const source = readRepoFile('admin-studio.js');
    const warmSource = extractFunction(source, 'warmAdminAIServicePreference');
    const initializeSource = extractFunction(source, 'initializeAdminStudioShell');

    const callLog = [];
    const context = {
        console: {
            warn() {}
        },
        bindAdminStudioDelegatedControls() {},
        observeAdminScrollbarAutoHide() {},
        observeAdminStudioModalScrollLock() {},
        initUploadZone() {},
        initForm() {},
        initCustomDropdown() {},
        renderCodexConfigPanel() {},
        refreshCodexConfig() {
            callLog.push('refresh-codex');
            return Promise.resolve(true);
        },
        initStarrySky() {},
        initBatchOperations() {},
        getAdminGalleryRouteState() {
            return { view: 'create' };
        },
        switchView() {
            callLog.push('switch-view');
        },
        checkApiKey() {
            callLog.push(`check:${context.window.ADMIN_AI_SERVICE}`);
            return Promise.resolve();
        },
        window: {
            ADMIN_AI_SERVICE: 'gemini',
            warmSettingsDomainsInBackground(domains) {
                callLog.push(`warm:${Array.isArray(domains) ? domains.join(',') : domains}`);
                return Promise.resolve([{ status: 'fulfilled' }]);
            },
            applyAdminAIServicePreference() {
                callLog.push('apply-preference');
                context.window.ADMIN_AI_SERVICE = 'codex';
                return { ai_service: 'codex' };
            },
            AdminSiteFilter: {
                renderSiteSelector() {
                    callLog.push('render-site-selector');
                }
            }
        }
    };

    vm.runInNewContext(`
        let adminAIServicePreferenceWarmPromise = null;
        ${warmSource}
        ${initializeSource}
        globalThis.initializeAdminStudioShell = initializeAdminStudioShell;
    `, context);

    await context.initializeAdminStudioShell();

    assert.equal(callLog.includes('check:gemini'), false);
    assert.equal(callLog.includes('check:codex'), true);
    assert.ok(callLog.indexOf('warm:growth') < callLog.indexOf('check:codex'));
    assert.ok(callLog.indexOf('apply-preference') < callLog.indexOf('check:codex'));
});
