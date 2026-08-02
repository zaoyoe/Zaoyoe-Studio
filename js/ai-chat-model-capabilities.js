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

    return Object.freeze({
        inferAiChatModelFamily,
        resolveAiChatModelCapabilities
    });
}));
