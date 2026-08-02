(function (root, factory) {
    'use strict';

    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.AIChatModelCapabilities = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    function normalize(value = '') {
        return String(value || '').trim().toLowerCase();
    }

    const WORKBENCH_CHAT_IMAGE_FORMATS = Object.freeze(['JPG', 'PNG', 'WebP']);
    const WORKBENCH_CHAT_IMAGE_MAX_COUNT = 16;
    const WORKBENCH_CHAT_IMAGE_MAX_FILE_BYTES = 12 * 1024 * 1024;

    function normalizeOptionalBoolean(value) {
        if (value === true || value === false) return value;
        const normalized = normalize(value);
        if (!normalized) return null;
        if (['true', '1', 'yes', 'on', 'enabled'].includes(normalized)) return true;
        if (['false', '0', 'no', 'off', 'disabled'].includes(normalized)) return false;
        return null;
    }

    function inferAiChatModelFamily({ model = '', vendor = '', protocol = '', providerLabel = '' } = {}) {
        const id = normalize(model);
        const provider = `${normalize(vendor)} ${normalize(protocol)} ${normalize(providerLabel)}`;

        if (/(^|[-_/])gemini([-_/]|$)/.test(id)) return 'gemini';
        if (/(^|[-_/])grok([-_/]|$)/.test(id)) return 'grok';
        if (/(^|[-_/])deepseek([-_/]|$)/.test(id)) return 'deepseek';
        if (/(^|[-_/])(kimi|moonshot)([-_/]|$)/.test(id)) return 'kimi';
        if (/(^|[-_/])qwen(?:\d|[-_/]|$)/.test(id)) return 'qwen';
        if (/(^|[-_/])(glm|zhipu)([-_/]|$)/.test(id)) return 'glm';
        if (/(^|[-_/])minimax([-_/]|$)/.test(id)) return 'minimax';
        if (/(^|[-_/])(doubao|seed)([-_/]|$)/.test(id)) return 'doubao';
        if (/(^|[-_/])(claude|opus|sonnet|haiku)([-_/]|$)/.test(id)) return 'claude';
        if (/(^|[-_/])(gpt|chatgpt|o\d)([-_/]|$)/.test(id)) return 'openai';

        if (/gemini/.test(provider)) return 'gemini';
        if (/anthropic/.test(provider)) return 'claude';
        if (/xai|x\.ai/.test(provider)) return 'grok';
        if (/openai/.test(provider)) return 'openai';
        return 'unknown';
    }

    function resolveAiChatModelCapabilities(input = {}) {
        const model = normalize(input.model);
        const family = inferAiChatModelFamily(input);
        const profile = {
            family,
            supportsThinking: false,
            thinkingRequest: '',
            reasoningEffortProfile: '',
            reasoningEfforts: [],
            thinkingLevelProfile: '',
            thinkingBudgetProfile: ''
        };

        if (family === 'openai' && /(^|[-_/])(gpt-5|o\d)([.\-_/]|$)/.test(model)) {
            const reasoningEfforts = ['low', 'medium', 'high'];
            if (/^gpt-5\.4(?![-_/](?:mini|nano))/.test(model)) reasoningEfforts.unshift('minimal');
            if (/^gpt-5\.(?:4|5|6)(?:[.\-_/]|$)/.test(model)) reasoningEfforts.push('xhigh');
            return {
                ...profile,
                supportsThinking: true,
                thinkingRequest: 'reasoning_effort',
                reasoningEffortProfile: 'openai',
                reasoningEfforts
            };
        }
        if (family === 'gemini' && /gemini[-_/]?(?:2\.5|2-5|2_5|[3-9](?:[.\-_/]|$))/.test(model)) {
            return {
                ...profile,
                supportsThinking: true,
                thinkingRequest: 'gemini',
                thinkingLevelProfile: /gemini[-_/]?[3-9](?:[.\-_/]|$)/.test(model) ? 'gemini' : ''
            };
        }
        if (family === 'grok' && !/(?:non[-_]?reasoning|composer|imagine|image|video)/.test(model)) {
            return { ...profile, supportsThinking: true, thinkingRequest: 'reasoning_effort', reasoningEffortProfile: 'xai' };
        }
        if (family === 'deepseek' && /(?:deepseek[-_/]v4|reasoner|[-_/]r1(?:[-_/]|$)|thinking)/.test(model)) {
            return { ...profile, supportsThinking: true, thinkingRequest: 'thinking_object', reasoningEffortProfile: 'deepseek' };
        }
        if (family === 'qwen' && !/(?:^|[-_/])(vl|vision|image|audio|omni|embedding)(?:[-_/]|$)/.test(model)) {
            return { ...profile, supportsThinking: true, thinkingRequest: 'enable_thinking' };
        }
        if (family === 'kimi' && /(?:kimi[-_/]?k(?:2\.[5-9]|[3-9])|thinking|moonshot)/.test(model)) {
            return { ...profile, supportsThinking: true, thinkingRequest: 'thinking_object' };
        }
        if (family === 'glm' && /glm[-_/]?(?:4\.5|[5-9])/.test(model)) {
            return {
                ...profile,
                supportsThinking: true,
                thinkingRequest: 'thinking_object',
                reasoningEffortProfile: /glm[-_/]?5\.2/.test(model) ? 'glm' : ''
            };
        }
        if (family === 'minimax' && /minimax[-_/]?m(?:2\.7|3)(?:[-_/]|$)/.test(model)) {
            return { ...profile, supportsThinking: true, thinkingRequest: 'thinking_object_adaptive' };
        }
        if (family === 'doubao' && /(?:thinking|doubao[-_/]seed[-_/]2[-_/]1[-_/](?:turbo|pro)(?:[-_/]|$))/.test(model)) {
            return { ...profile, supportsThinking: true, thinkingRequest: 'thinking_object' };
        }
        if (family === 'claude' && /(?:claude[-_/].*(?:3\.7|3-7|[4-9])|(?:opus|sonnet)[-_/].*[4-9])/.test(model)) {
            return {
                ...profile,
                supportsThinking: true,
                thinkingRequest: 'claude_thinking',
                thinkingBudgetProfile: 'claude'
            };
        }
        return profile;
    }

    function getOfficialImageInputProfile(input = {}) {
        const model = normalize(input.model).replace(/^models\//, '');
        const family = inferAiChatModelFamily(input);
        const explicitVisionModel = /(?:^|[-_/])(vl|vision|omni|4v)(?:[-_/\.\d]|$)/.test(model);

        if (family === 'openai' && /(?:^|[-_/])(gpt-4o|gpt-4\.1|gpt-5(?:[.\-_/]|$)|o1(?:[.\-_/]|$)|o3(?:[.\-_/]|$)|o4(?:[.\-_/]|$))/.test(model)) {
            return {
                family,
                officialSourceLabel: 'OpenAI 官方模型文档',
                officialMaxCount: null,
                officialMaxFileBytes: null
            };
        }
        if (family === 'gemini' && /(?:^|[-_/])gemini(?:[-_/]|$)/.test(model) && !/(?:embedding|image-generation)/.test(model)) {
            return {
                family,
                officialSourceLabel: 'Google Gemini 官方模型文档',
                officialMaxCount: null,
                officialMaxFileBytes: null
            };
        }
        const officialClaudeVisionModel = /(?:^|[-_/])claude[-_/]?(?:[3-9](?:[.\-_/]|$)|(?:opus|sonnet|haiku|fable)(?:[-_/]|$))/.test(model)
            || /(?:^|[-_/])(?:opus|sonnet|haiku|fable)(?:[-_/].*)?[3-9](?:[.\-_/]|$)/.test(model);
        if (family === 'claude' && officialClaudeVisionModel) {
            return {
                family,
                officialSourceLabel: 'Anthropic Claude 官方视觉文档',
                officialMaxCount: 20,
                officialMaxFileBytes: 5 * 1024 * 1024
            };
        }
        if (explicitVisionModel) {
            const sourceLabels = {
                deepseek: 'DeepSeek 官方模型文档',
                qwen: '通义千问官方模型文档',
                kimi: 'Moonshot Kimi 官方模型文档',
                glm: '智谱 GLM 官方模型文档',
                grok: 'xAI Grok 官方模型文档',
                minimax: 'MiniMax 官方模型文档',
                doubao: '豆包官方模型文档'
            };
            return {
                family,
                officialSourceLabel: sourceLabels[family] || '模型官方文档',
                officialMaxCount: null,
                officialMaxFileBytes: null
            };
        }
        return null;
    }

    function resolveAiChatImageInputPolicy(input = {}) {
        const family = inferAiChatModelFamily(input);
        const channelSupport = normalizeOptionalBoolean(input.supportsImageInput ?? input.supports_image_input);
        const officialProfile = getOfficialImageInputProfile(input);
        const officialMaxCount = Number(officialProfile?.officialMaxCount) > 0
            ? Number(officialProfile.officialMaxCount)
            : null;
        const officialMaxFileBytes = Number(officialProfile?.officialMaxFileBytes) > 0
            ? Number(officialProfile.officialMaxFileBytes)
            : null;
        const maxCount = officialMaxCount
            ? Math.min(WORKBENCH_CHAT_IMAGE_MAX_COUNT, officialMaxCount)
            : WORKBENCH_CHAT_IMAGE_MAX_COUNT;
        const maxFileBytes = officialMaxFileBytes
            ? Math.min(WORKBENCH_CHAT_IMAGE_MAX_FILE_BYTES, officialMaxFileBytes)
            : WORKBENCH_CHAT_IMAGE_MAX_FILE_BYTES;
        const status = channelSupport === true
            ? 'channel_verified'
            : (channelSupport === false
                ? 'channel_unsupported'
                : (officialProfile ? 'official_unverified' : 'unverified'));

        return Object.freeze({
            status,
            available: status === 'channel_verified',
            family,
            officialSourceLabel: officialProfile?.officialSourceLabel || '',
            formats: WORKBENCH_CHAT_IMAGE_FORMATS,
            maxCount,
            maxFileBytes,
            officialMaxCount,
            officialMaxFileBytes,
            workbenchMaxCount: WORKBENCH_CHAT_IMAGE_MAX_COUNT,
            workbenchMaxFileBytes: WORKBENCH_CHAT_IMAGE_MAX_FILE_BYTES
        });
    }

    return Object.freeze({
        inferAiChatModelFamily,
        resolveAiChatModelCapabilities,
        resolveAiChatImageInputPolicy
    });
}));
