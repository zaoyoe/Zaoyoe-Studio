(function () {
    'use strict';

    function extractChatContentText(content) {
        if (typeof content === 'string') {
            return content.trim();
        }

        if (!Array.isArray(content)) {
            return '';
        }

        return content
            .map((part) => {
                if (typeof part === 'string') {
                    return part.trim();
                }

                if (part && typeof part === 'object') {
                    return String(part.text || part.output_text || part.content || '').trim();
                }

                return '';
            })
            .filter(Boolean)
            .join('\n')
            .trim();
    }

    function extractResponsesOutputText(payload = {}) {
        if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
            return payload.output_text.trim();
        }

        if (typeof payload?.response?.output_text === 'string' && payload.response.output_text.trim()) {
            return payload.response.output_text.trim();
        }

        const responseOutput = Array.isArray(payload?.output) ? payload.output : [];
        const textParts = [];

        responseOutput.forEach((item) => {
            const contentItems = Array.isArray(item?.content) ? item.content : [];
            contentItems.forEach((contentItem) => {
                const text = String(
                    contentItem?.text
                    || contentItem?.output_text
                    || contentItem?.content
                    || ''
                ).trim();
                if (text) {
                    textParts.push(text);
                }
            });
        });

        return textParts.join('\n').trim();
    }

    function extractAdminProxyText(response = {}) {
        if (typeof response?.text === 'string' && response.text.trim()) {
            return response.text.trim();
        }

        const rawResult = response?.result;
        if (!rawResult || typeof rawResult !== 'object') {
            return '';
        }

        return extractResponsesOutputText(rawResult)
            || extractChatContentText(rawResult?.choices?.[0]?.message?.content || rawResult?.message?.content)
            || rawResult?.candidates?.[0]?.content?.parts?.map((part) => String(part?.text || '').trim()).filter(Boolean).join('\n').trim()
            || '';
    }

    const SERVICE_META = {
        gemini: {
            route: '/api/admin?route=gemini',
            label: 'Gemini',
            defaultModel: 'gemini-2.0-flash'
        },
        codex: {
            route: '/api/admin?route=codex',
            label: 'Codex Relay',
            defaultModel: 'gpt-5.4'
        },
        claude: {
            route: '',
            label: 'Claude',
            defaultModel: 'claude-3-7-sonnet'
        }
    };

    const TOKEN_BUDGET_PRESETS = Object.freeze({
        lean: {
            tier: 'lean',
            maxInputChars: 6000,
            maxOutputTokens: 600
        },
        balanced: {
            tier: 'balanced',
            maxInputChars: 12000,
            maxOutputTokens: 900
        },
        expanded: {
            tier: 'expanded',
            maxInputChars: 24000,
            maxOutputTokens: 1600
        },
        longform: {
            tier: 'longform',
            maxInputChars: 24000,
            maxOutputTokens: 8192
        }
    });
    const TOKEN_BUDGET_ALIASES = Object.freeze({
        compact: 'lean',
        concise: 'lean',
        low: 'lean',
        lean: 'lean',
        normal: 'balanced',
        balanced: 'balanced',
        standard: 'balanced',
        deep: 'expanded',
        expanded: 'expanded',
        longform: 'longform'
    });

    function clampInteger(value, min, max, fallback = min) {
        const numberValue = Number(value);
        if (!Number.isFinite(numberValue)) {
            return fallback;
        }

        return Math.min(max, Math.max(min, Math.floor(numberValue)));
    }

    function estimateTokenCountFromChars(charCount = 0) {
        return Math.max(0, Math.ceil((Number(charCount) || 0) / 4));
    }

    function emitAdminAIEvent(name, detail = {}) {
        try {
            window.dispatchEvent(new CustomEvent(name, {
                detail
            }));
        } catch (_) {
            // CustomEvent is unavailable in a few test contexts.
        }
    }

    function createBudgetState(budget = {}) {
        return {
            maxInputChars: Number(budget.maxInputChars) || 0,
            inputChars: 0,
            truncated: false,
            truncatedChars: 0
        };
    }

    function applyTextBudget(value, state) {
        const source = String(value || '');
        if (!source || !state?.maxInputChars) {
            return source;
        }

        const remainingChars = Math.max(0, state.maxInputChars - state.inputChars);
        const nextValue = source.slice(0, remainingChars);
        state.inputChars += nextValue.length;

        if (source.length > nextValue.length) {
            state.truncated = true;
            state.truncatedChars += source.length - nextValue.length;
        }

        return nextValue;
    }

    function applyBudgetToContent(content, state) {
        if (typeof content === 'string') {
            return applyTextBudget(content, state);
        }

        if (!Array.isArray(content)) {
            return content;
        }

        return content.map((part) => {
            if (!part || typeof part !== 'object' || Array.isArray(part)) {
                return part;
            }

            const nextPart = { ...part };
            if (typeof nextPart.text === 'string') {
                nextPart.text = applyTextBudget(nextPart.text, state);
            } else if (typeof nextPart.output_text === 'string') {
                nextPart.output_text = applyTextBudget(nextPart.output_text, state);
            } else if (typeof nextPart.content === 'string') {
                nextPart.content = applyTextBudget(nextPart.content, state);
            }
            return nextPart;
        });
    }

    function applyBudgetToMessages(messages = [], state) {
        if (!Array.isArray(messages)) {
            return messages;
        }

        return messages.map((message) => {
            if (!message || typeof message !== 'object' || Array.isArray(message)) {
                return message;
            }

            return {
                ...message,
                content: applyBudgetToContent(message.content, state)
            };
        });
    }

    function applyBudgetToGeminiContents(contents = [], state) {
        if (!Array.isArray(contents)) {
            return contents;
        }

        return contents.map((item) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
                return item;
            }

            return {
                ...item,
                parts: (Array.isArray(item.parts) ? item.parts : []).map((part) => {
                    if (!part || typeof part !== 'object' || Array.isArray(part)) {
                        return part;
                    }

                    if (typeof part.text !== 'string') {
                        return part;
                    }

                    return {
                        ...part,
                        text: applyTextBudget(part.text, state)
                    };
                })
            };
        });
    }

    function getElapsedMs(startedAt) {
        if (typeof performance !== 'undefined' && performance?.now) {
            return Math.max(0, Math.round(performance.now() - startedAt));
        }
        return 0;
    }

    function normalizeHeadersObject(headers) {
        if (typeof Headers !== 'undefined' && headers instanceof Headers) {
            const nextHeaders = {};
            headers.forEach((value, key) => {
                nextHeaders[key] = value;
            });
            return nextHeaders;
        }

        return headers && typeof headers === 'object'
            ? { ...headers }
            : {};
    }

    function parseRetryDelayMs(value, now = Date.now()) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return Math.max(0, Math.round(value));
        }

        const normalized = String(value || '').trim();
        if (!normalized) return 0;
        if (/^\d+(?:\.\d+)?$/.test(normalized)) {
            return Math.max(0, Math.round(Number(normalized) * 1000));
        }

        const durationMatch = normalized.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m)$/i);
        if (durationMatch) {
            const multiplier = durationMatch[2].toLowerCase() === 'm'
                ? 60000
                : (durationMatch[2].toLowerCase() === 's' ? 1000 : 1);
            return Math.max(0, Math.round(Number(durationMatch[1]) * multiplier));
        }

        const retryAt = Date.parse(normalized);
        return Number.isFinite(retryAt) ? Math.max(0, retryAt - now) : 0;
    }

    function resolveAdminAIRetryAfterMs(response, payload = {}) {
        const headerValue = response?.headers && typeof response.headers.get === 'function'
            ? response.headers.get('retry-after')
            : '';
        const candidateValues = [
            headerValue,
            payload?.retryAfterMs,
            payload?.retry_after_ms,
            payload?.retryAfterSeconds === undefined ? '' : `${payload.retryAfterSeconds}s`,
            payload?.retry_after_seconds === undefined ? '' : `${payload.retry_after_seconds}s`,
            payload?.error?.retryAfterMs,
            payload?.error?.retry_after_ms,
            ...(Array.isArray(payload?.error?.details)
                ? payload.error.details.flatMap((detail) => [
                    detail?.retryDelay,
                    detail?.retry_delay,
                    detail?.retryAfter
                ])
                : [])
        ];

        for (const candidate of candidateValues) {
            if (candidate === undefined || candidate === null || candidate === '') continue;
            const parsed = parseRetryDelayMs(candidate);
            if (parsed > 0) return parsed;
        }
        return 0;
    }

    const AdminAI = {
        configured: false,
        defaultModel: 'gemini-2.0-flash',
        source: 'missing',
        healthChecked: false,
        _healthPromise: null,
        _healthService: '',
        preferredService: 'gemini',
        activeService: 'gemini',
        lastBudget: null,
        lastLatencyMs: 0,
        lastOutputChars: 0,
        lastResponseOk: null,
        lastStatus: 'idle',
        lastMessage: '',
        budgetPresets: TOKEN_BUDGET_PRESETS,

        normalizeService(service) {
            const normalized = String(service || '').trim().toLowerCase();
            if (normalized === 'openai') return 'codex';
            return SERVICE_META[normalized] ? normalized : 'gemini';
        },

        getServiceMeta(service = this.getPreferredService()) {
            return SERVICE_META[this.normalizeService(service)] || SERVICE_META.gemini;
        },

        getPreferredService() {
            const configuredService = typeof window.getCurrentAdminAIService === 'function'
                ? window.getCurrentAdminAIService()
                : window.ADMIN_AI_SERVICE;
            const normalized = this.normalizeService(configuredService || this.preferredService || 'gemini');
            this.preferredService = normalized;
            return normalized;
        },

        getServiceLabel(service = this.getPreferredService()) {
            return this.getServiceMeta(service).label;
        },

        getMissingConfigMessage(service = this.getPreferredService()) {
            const normalized = this.normalizeService(service);
            if (normalized === 'codex') {
                return '请先在后台 API 配置中填写 Codex Relay 的 Base URL、Model、接口格式，并录入 API Key';
            }
            if (normalized === 'claude') {
                return '当前后台尚未接入 Claude 代理，请先切换到 Gemini 或 Codex Relay';
            }
            return '请先在后台 API 配置或 Vercel 环境变量中配置 Gemini Key';
        },

        getCommandCenterSummary() {
            const service = this.normalizeService(this.activeService || this.getPreferredService());
            const serviceLabel = this.getServiceLabel(service);
            const latestBudget = this.lastBudget && typeof this.lastBudget === 'object'
                ? this.lastBudget
                : null;
            const hasRuntimeSignal = this.healthChecked
                || latestBudget !== null
                || this.lastResponseOk !== null;
            const configured = Boolean(this.configured);
            const actionableCount = configured
                ? (this.lastResponseOk === false ? 1 : 0)
                : 1;
            const recentItems = [];

            if (!configured) {
                recentItems.push({
                    label: 'AI 配置',
                    copy: String(this.lastMessage || this.getMissingConfigMessage(service)).trim() || '尚未完成 AI 配置',
                    tone: 'warn',
                    moduleId: 'settings',
                    stateKey: 'budget-recent-config',
                    feedbackLabel: 'AI 配置',
                    intent: '打开通用设置中的 Codex Relay 配置入口。',
                    context: {
                        action: 'general',
                        payload: {
                            defaultTab: 'general',
                            focusTargetId: 'codexConfigPanel'
                        }
                    },
                    options: {
                        viewName: 'general',
                        settingsView: 'general',
                        focusTargetId: 'codexConfigPanel'
                    }
                });
            } else {
                recentItems.push({
                    label: 'AI 服务',
                    copy: `${serviceLabel} · ${String(this.defaultModel || this.getServiceMeta(service).defaultModel || '').trim() || '默认模型'}`,
                    tone: 'ok',
                    moduleId: 'settings',
                    stateKey: 'budget-recent-service',
                    feedbackLabel: 'AI 服务',
                    intent: '打开 AI 服务配置与当前接入状态。',
                    context: {
                        action: 'general',
                        payload: {
                            defaultTab: 'general',
                            focusTargetId: 'aiServiceDropdown'
                        }
                    },
                    options: {
                        viewName: 'general',
                        settingsView: 'general',
                        focusTargetId: 'aiServiceDropdown'
                    }
                });
            }

            if (this.lastResponseOk === false || String(this.lastStatus || '').trim().toLowerCase() === 'error') {
                recentItems.unshift({
                    label: '最近请求',
                    copy: String(this.lastMessage || 'AI 请求失败').trim() || 'AI 请求失败',
                    tone: 'alert',
                    moduleId: 'settings',
                    stateKey: 'budget-recent-runtime',
                    feedbackLabel: 'AI 运行态',
                    intent: '打开 AI 配置，检查最近一次请求失败原因。',
                    context: {
                        action: 'general',
                        payload: {
                            defaultTab: 'general',
                            focusTargetId: 'codexConfigPanel'
                        }
                    },
                    options: {
                        viewName: 'general',
                        settingsView: 'general',
                        focusTargetId: 'codexConfigPanel'
                    }
                });
            } else if (Number(this.lastLatencyMs || 0) > 0) {
                recentItems.push({
                    label: '最近请求',
                    copy: `耗时 ${Math.round(Number(this.lastLatencyMs || 0))}ms`,
                    tone: 'ok',
                    moduleId: 'settings',
                    stateKey: 'budget-recent-latency',
                    feedbackLabel: 'AI 服务',
                    intent: '打开 AI 服务配置，查看当前接入服务。',
                    context: {
                        action: 'general',
                        payload: {
                            defaultTab: 'general',
                            focusTargetId: 'aiServiceDropdown'
                        }
                    },
                    options: {
                        viewName: 'general',
                        settingsView: 'general',
                        focusTargetId: 'aiServiceDropdown'
                    }
                });
            }

            return {
                ready: hasRuntimeSignal,
                status: String(this.lastStatus || (configured ? 'ready' : 'idle')).trim().toLowerCase() || 'idle',
                configured,
                service,
                serviceLabel,
                model: String(this.defaultModel || this.getServiceMeta(service).defaultModel || '').trim(),
                source: String(this.source || 'missing').trim() || 'missing',
                budgetTier: String(latestBudget?.tier || '').trim(),
                estimatedInputTokens: Number(latestBudget?.estimatedInputTokens || 0) || 0,
                maxOutputTokens: Number(latestBudget?.maxOutputTokens || 0) || 0,
                truncated: latestBudget?.truncated === true,
                truncatedChars: Number(latestBudget?.truncatedChars || 0) || 0,
                lastLatencyMs: Number(this.lastLatencyMs || 0) || 0,
                lastOutputChars: Number(this.lastOutputChars || 0) || 0,
                lastResponseOk: this.lastResponseOk,
                lastMessage: String(this.lastMessage || '').trim(),
                actionableCount,
                recentItems: recentItems.slice(0, 3)
            };
        },

        emitCommandCenterSummaryUpdate() {
            emitAdminAIEvent('admin-ai-command-summary-updated', this.getCommandCenterSummary());
        },

        setPreferredService(service, options = {}) {
            const normalized = this.normalizeService(service);
            const changed = normalized !== this.preferredService;
            this.preferredService = normalized;

            if (changed) {
                this._healthPromise = null;
                this._healthService = '';
                this.configured = false;
                this.healthChecked = false;
                this.activeService = normalized;
                this.lastMessage = '';
                this.lastStatus = 'idle';
                this.emitCommandCenterSummaryUpdate();
            }

            if (options.refresh === true) {
                return this.checkHealth(true).catch(() => null);
            }

            return Promise.resolve(null);
        },

        resolveRoute(service = this.getPreferredService()) {
            return this.getServiceMeta(service).route;
        },

        resolveModel(model, service = this.getPreferredService()) {
            const candidate = String(model || '').trim();
            const meta = this.getServiceMeta(service);
            const fallbackModel = String(this.defaultModel || meta.defaultModel || '').trim() || meta.defaultModel;

            if (!candidate) {
                return fallbackModel;
            }

            if (service === 'codex' && /^gemini-/i.test(candidate)) {
                return fallbackModel;
            }

            if (service === 'gemini' && !/^gemini-/i.test(candidate)) {
                return fallbackModel;
            }

            return candidate;
        },

        estimatePromptTokens(text = '') {
            return estimateTokenCountFromChars(String(text || '').length);
        },

        resolveTokenBudget(value = null) {
            const rawBudget = value || {};
            const rawTier = typeof rawBudget === 'string'
                ? rawBudget
                : (rawBudget.tier || rawBudget.mode || rawBudget.level || rawBudget.preset);
            const tier = TOKEN_BUDGET_ALIASES[String(rawTier || '').trim().toLowerCase()] || 'balanced';
            const preset = TOKEN_BUDGET_PRESETS[tier] || TOKEN_BUDGET_PRESETS.balanced;
            const requestedMaxInputChars = rawBudget && typeof rawBudget === 'object'
                ? rawBudget.maxInputChars || rawBudget.max_input_chars
                : undefined;
            const requestedMaxOutputTokens = rawBudget && typeof rawBudget === 'object'
                ? rawBudget.maxOutputTokens || rawBudget.max_output_tokens
                : undefined;

            return {
                tier,
                maxInputChars: clampInteger(
                    requestedMaxInputChars,
                    1000,
                    preset.maxInputChars,
                    preset.maxInputChars
                ),
                maxOutputTokens: clampInteger(
                    requestedMaxOutputTokens,
                    64,
                    preset.maxOutputTokens,
                    preset.maxOutputTokens
                )
            };
        },

        requireExplicitTokenBudget(value = null) {
            const rawBudget = value || null;
            const rawTier = typeof rawBudget === 'string'
                ? rawBudget
                : (rawBudget?.tier || rawBudget?.mode || rawBudget?.level || rawBudget?.preset);

            if (!String(rawTier || '').trim()) {
                const error = new Error('AdminAI budget tier is required');
                error.code = 'ADMIN_AI_BUDGET_REQUIRED';
                error.status = 400;
                throw error;
            }

            return this.resolveTokenBudget(rawBudget);
        },

        prepareBudgetedPayload({ prompt = '', contents = [], messages = [] } = {}, budget) {
            const state = createBudgetState(budget);
            const nextMessages = applyBudgetToMessages(messages, state);
            const nextContents = applyBudgetToGeminiContents(contents, state);
            const hasStructuredInput = (Array.isArray(nextMessages) && nextMessages.length > 0)
                || (Array.isArray(nextContents) && nextContents.length > 0);
            const nextPrompt = hasStructuredInput
                ? ''
                : (typeof prompt === 'string'
                ? applyTextBudget(prompt, state)
                : prompt);

            return {
                prompt: nextPrompt,
                messages: nextMessages,
                contents: nextContents,
                budget: {
                    ...budget,
                    inputChars: state.inputChars,
                    estimatedInputTokens: estimateTokenCountFromChars(state.inputChars),
                    truncated: state.truncated,
                    truncatedChars: state.truncatedChars
                }
            };
        },

        async getAuthHeaders() {
            const baseHeaders = {
                'Content-Type': 'application/json'
            };

            if (window.AdminApi?.buildRequestInit) {
                try {
                    const requestInit = await window.AdminApi.buildRequestInit({
                        headers: baseHeaders
                    });
                    return normalizeHeadersObject(requestInit?.headers || baseHeaders);
                } catch (_) {
                    // Fall through to direct session lookup.
                }
            }

            let accessToken = '';

            try {
                const { data: { session } = {} } = await window.supabaseClient.auth.getSession();
                accessToken = String(session?.access_token || '').trim();
            } catch (_) {
                accessToken = '';
            }

            if (!accessToken && typeof window.supabaseClient?.accessToken === 'function') {
                try {
                    accessToken = String(await window.supabaseClient.accessToken() || '').trim();
                } catch (_) {
                    accessToken = '';
                }
            }

            if (accessToken) {
                baseHeaders.Authorization = `Bearer ${accessToken}`;
            }

            return baseHeaders;
        },

        extractText(response) {
            return extractAdminProxyText(response);
        },

        async checkHealth(force = false) {
            const service = this.getPreferredService();
            const route = this.resolveRoute(service);
            const meta = this.getServiceMeta(service);
            const hadKnownConfig = this.configured === true;
            const previousSource = this.source;

            if (!route) {
                this.configured = false;
                this.healthChecked = true;
                this.activeService = service;
                this.defaultModel = meta.defaultModel;
                this.source = 'missing';
                this.lastStatus = 'error';
                this.lastMessage = this.getMissingConfigMessage(service);
                this.emitCommandCenterSummaryUpdate();
                throw new Error(this.lastMessage);
            }

            if (this._healthPromise && !force && this._healthService === service) {
                return this._healthPromise;
            }

            this._healthPromise = (async () => {
                const headers = await this.getAuthHeaders();
                const response = await fetch(route, {
                    method: 'GET',
                    credentials: 'include',
                    headers
                });

                const payload = await response.json().catch(() => ({}));
                if (!response.ok || !payload.success) {
                    const error = new Error(payload.message || 'AI proxy unavailable');
                    error.status = response.status;
                    error.details = payload?.error || payload || null;
                    throw error;
                }

                this.configured = Boolean(payload.configured);
                this.healthChecked = true;
                this.defaultModel = payload.model || meta.defaultModel || this.defaultModel;
                this.source = payload.source || (payload.configured ? 'environment' : 'missing');
                this.activeService = service;
                this.lastStatus = payload.configured ? 'ready' : 'warning';
                this.lastMessage = payload.configured ? '' : this.getMissingConfigMessage(service);
                this.emitCommandCenterSummaryUpdate();
                return {
                    ...payload,
                    service,
                    label: meta.label
                };
            })();
            this._healthService = service;

            try {
                return await this._healthPromise;
            } catch (error) {
                this.configured = hadKnownConfig ? true : false;
                this.healthChecked = true;
                this.activeService = service;
                if (hadKnownConfig && previousSource) {
                    this.source = previousSource;
                }
                this.lastStatus = 'error';
                this.lastMessage = error?.message || 'AI proxy unavailable';
                this.emitCommandCenterSummaryUpdate();
                throw error;
            } finally {
                if (force) {
                    this._healthPromise = null;
                    this._healthService = '';
                }
            }
        },

        async generate({ contents, generationConfig = {}, model = this.defaultModel, prompt, budget, tokenBudget, ...rest } = {}) {
            const service = this.getPreferredService();
            const route = this.resolveRoute(service);

            if (!route) {
                const error = new Error(this.getMissingConfigMessage(service));
                error.status = 400;
                throw error;
            }

            const resolvedBudget = this.requireExplicitTokenBudget(budget || tokenBudget || generationConfig?.budget || rest.budget);
            const headers = await this.getAuthHeaders();
            const preparedPayload = this.prepareBudgetedPayload({
                prompt,
                contents,
                messages: rest.messages
            }, resolvedBudget);
            const nextGenerationConfig = {
                ...(generationConfig && typeof generationConfig === 'object' ? generationConfig : {})
            };
            delete nextGenerationConfig.budget;
            if (typeof nextGenerationConfig.maxOutputTokens === 'undefined') {
                nextGenerationConfig.maxOutputTokens = resolvedBudget.maxOutputTokens;
            }
            const resolvedModel = this.resolveModel(model, service);
            const requestBody = {
                ...rest,
                prompt: preparedPayload.prompt,
                model: resolvedModel,
                contents: preparedPayload.contents,
                generationConfig: nextGenerationConfig,
                budget: {
                    tier: resolvedBudget.tier,
                    maxInputChars: resolvedBudget.maxInputChars,
                    maxOutputTokens: resolvedBudget.maxOutputTokens
                }
            };
            if (Array.isArray(preparedPayload.messages)) {
                requestBody.messages = preparedPayload.messages;
            }
            const startedAt = typeof performance !== 'undefined' && performance?.now ? performance.now() : 0;
            this.lastBudget = preparedPayload.budget || null;
            this.lastStatus = 'loading';
            this.lastMessage = '';
            this.emitCommandCenterSummaryUpdate();

            emitAdminAIEvent('admin-ai-budget', {
                service,
                model: resolvedModel,
                budget: preparedPayload.budget
            });

            try {
                const response = await fetch(route, {
                    method: 'POST',
                    credentials: 'include',
                    headers,
                    body: JSON.stringify(requestBody)
                });

                const responseText = await response.text();
                let payload = {};

                if (responseText) {
                    try {
                        payload = JSON.parse(responseText);
                    } catch (_) {
                        payload = {
                            rawText: responseText
                        };
                    }
                }

                if (!response.ok || !payload.success) {
                    const fallbackMessage = String(payload?.rawText || '').trim().slice(0, 200);
                    const error = new Error(payload.message || payload?.error?.message || fallbackMessage || 'AI request failed');
                    error.status = response.status;
                    error.details = payload.error || null;
                    error.isRateLimited = response.status === 429
                        || /resource exhausted|quota|429/i.test(String(error.message || ''));
                    error.retryAfterMs = resolveAdminAIRetryAfterMs(response, payload);
                    throw error;
                }

                this.configured = true;
                this.healthChecked = true;
                this.activeService = service;
                if (this.source === 'missing') {
                    this.source = 'runtime';
                }
                if (payload.model) {
                    this.defaultModel = payload.model;
                }
                this.lastLatencyMs = getElapsedMs(startedAt);
                this.lastOutputChars = this.extractText(payload).length;
                this.lastResponseOk = true;
                this.lastStatus = 'ready';
                this.lastMessage = '';
                this.emitCommandCenterSummaryUpdate();
                emitAdminAIEvent('admin-ai-response', {
                    ok: true,
                    service,
                    model: payload.model || resolvedModel,
                    apiFormat: payload.apiFormat || '',
                    budget: payload.budget || preparedPayload.budget,
                    durationMs: this.lastLatencyMs,
                    outputChars: this.lastOutputChars
                });
                return payload;
            } catch (error) {
                this.healthChecked = true;
                this.activeService = service;
                this.lastLatencyMs = getElapsedMs(startedAt);
                this.lastOutputChars = 0;
                this.lastResponseOk = false;
                this.lastStatus = 'error';
                this.lastMessage = error.message || 'AI request failed';
                this.emitCommandCenterSummaryUpdate();
                emitAdminAIEvent('admin-ai-response', {
                    ok: false,
                    service,
                    model: resolvedModel,
                    budget: preparedPayload.budget,
                    durationMs: this.lastLatencyMs,
                    status: error.status || 0,
                    message: error.message || 'AI request failed',
                    retryAfterMs: Number(error.retryAfterMs) || 0
                });
                throw error;
            }
        },

        async primeCommandCenterSummary(options = {}) {
            try {
                await this.checkHealth(options.force === true);
            } catch (_) {
                // Command center should still receive the latest runtime snapshot.
            }
            return this.getCommandCenterSummary();
        },

        async generateText(prompt, options = {}) {
            const payload = await this.generate({
                prompt,
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: options.generationConfig || {},
                model: options.model || this.defaultModel,
                budget: options.budget || options.tokenBudget || null
            });

            return this.extractText(payload);
        }
    };

    window.AdminAI = AdminAI;
})();
