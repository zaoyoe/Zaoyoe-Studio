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

    const AdminAI = {
        configured: false,
        defaultModel: 'gemini-2.0-flash',
        source: 'missing',
        _healthPromise: null,
        _healthService: '',
        preferredService: 'gemini',
        activeService: 'gemini',

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

        setPreferredService(service, options = {}) {
            const normalized = this.normalizeService(service);
            const changed = normalized !== this.preferredService;
            this.preferredService = normalized;

            if (changed) {
                this._healthPromise = null;
                this._healthService = '';
                this.configured = false;
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

        async getAuthHeaders() {
            const headers = {
                'Content-Type': 'application/json'
            };
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
                headers.Authorization = `Bearer ${accessToken}`;
            }

            return headers;
        },

        extractText(response) {
            return extractAdminProxyText(response);
        },

        async checkHealth(force = false) {
            const service = this.getPreferredService();
            const route = this.resolveRoute(service);
            const meta = this.getServiceMeta(service);

            if (!route) {
                this.configured = false;
                this.activeService = service;
                this.defaultModel = meta.defaultModel;
                throw new Error(this.getMissingConfigMessage(service));
            }

            if (this._healthPromise && !force && this._healthService === service) {
                return this._healthPromise;
            }

            this._healthPromise = (async () => {
                const headers = await this.getAuthHeaders();
                const response = await fetch(route, {
                    method: 'GET',
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
                this.defaultModel = payload.model || meta.defaultModel || this.defaultModel;
                this.source = payload.source || (payload.configured ? 'environment' : 'missing');
                this.activeService = service;
                return {
                    ...payload,
                    service,
                    label: meta.label
                };
            })();
            this._healthService = service;

            try {
                return await this._healthPromise;
            } finally {
                if (force) {
                    this._healthPromise = null;
                    this._healthService = '';
                }
            }
        },

        async generate({ contents, generationConfig = {}, model = this.defaultModel, prompt, ...rest } = {}) {
            const service = this.getPreferredService();
            const route = this.resolveRoute(service);

            if (!route) {
                const error = new Error(this.getMissingConfigMessage(service));
                error.status = 400;
                throw error;
            }

            const headers = await this.getAuthHeaders();
            const response = await fetch(route, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    ...rest,
                    prompt,
                    model: this.resolveModel(model, service),
                    contents,
                    generationConfig
                })
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
                throw error;
            }

            this.configured = true;
            this.activeService = service;
            if (payload.model) {
                this.defaultModel = payload.model;
            }
            return payload;
        },

        async generateText(prompt, options = {}) {
            const payload = await this.generate({
                prompt,
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: options.generationConfig || {},
                model: options.model || this.defaultModel
            });

            return this.extractText(payload);
        }
    };

    window.AdminAI = AdminAI;
})();
