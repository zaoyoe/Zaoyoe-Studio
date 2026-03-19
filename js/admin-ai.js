(function () {
    'use strict';

    const AdminAI = {
        configured: false,
        defaultModel: 'gemini-2.0-flash',
        source: 'missing',
        _healthPromise: null,

        async getAuthHeaders() {
            const { data: { session } = {} } = await window.supabaseClient.auth.getSession();
            const headers = {
                'Content-Type': 'application/json'
            };

            if (session?.access_token) {
                headers.Authorization = `Bearer ${session.access_token}`;
            }

            return headers;
        },

        extractText(response) {
            return response?.result?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        },

        async checkHealth(force = false) {
            if (this._healthPromise && !force) {
                return this._healthPromise;
            }

            this._healthPromise = (async () => {
                const headers = await this.getAuthHeaders();
                const response = await fetch('/api/admin/gemini', {
                    method: 'GET',
                    headers
                });

                const payload = await response.json().catch(() => ({}));
                if (!response.ok || !payload.success) {
                    this.configured = false;
                    throw new Error(payload.message || 'AI proxy unavailable');
                }

                this.configured = Boolean(payload.configured);
                this.defaultModel = payload.model || this.defaultModel;
                this.source = payload.source || (payload.configured ? 'environment' : 'missing');
                return payload;
            })();

            try {
                return await this._healthPromise;
            } finally {
                if (force) {
                    this._healthPromise = null;
                }
            }
        },

        async generate({ contents, generationConfig = {}, model = this.defaultModel }) {
            const headers = await this.getAuthHeaders();
            const response = await fetch('/api/admin/gemini', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model,
                    contents,
                    generationConfig
                })
            });

            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload.success) {
                throw new Error(payload.message || 'AI request failed');
            }

            this.configured = true;
            return payload;
        },

        async generateText(prompt, options = {}) {
            const payload = await this.generate({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: options.generationConfig || {},
                model: options.model || this.defaultModel
            });

            return this.extractText(payload);
        }
    };

    window.AdminAI = AdminAI;
})();
