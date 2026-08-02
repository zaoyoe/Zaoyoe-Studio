const test = require('node:test');
const assert = require('node:assert/strict');

const {
    resolveAiChatModelCapabilities,
    resolveAiChatImageInputPolicy
} = require('../js/ai-chat-model-capabilities');

const EXPECTED_CAPABILITIES = [
    ['gpt-5.4', 'openai', 'reasoning_effort', 'openai'],
    ['gpt-5.4-mini', 'openai', 'reasoning_effort', 'openai'],
    ['gpt-5.5', 'openai', 'reasoning_effort', 'openai'],
    ['gpt-5.6', 'openai', 'reasoning_effort', 'openai'],
    ['gpt-5.6-luna', 'openai', 'reasoning_effort', 'openai'],
    ['gpt-5.6-sol', 'openai', 'reasoning_effort', 'openai'],
    ['gpt-5.6-terra', 'openai', 'reasoning_effort', 'openai'],
    ['gemini-3.1-flash-lite', 'gemini', 'gemini', ''],
    ['gemini-3.1-flash-lite-preview', 'gemini', 'gemini', ''],
    ['gemini-3.5-flash', 'gemini', 'gemini', ''],
    ['gemini-3.1-pro-preview', 'gemini', 'gemini', ''],
    ['grok-4.3', 'grok', 'reasoning_effort', 'xai'],
    ['grok-4.5', 'grok', 'reasoning_effort', 'xai'],
    ['claude-fable-5', 'claude', 'claude_thinking', ''],
    ['claude-opus-4-6', 'claude', 'claude_thinking', ''],
    ['claude-opus-4-7', 'claude', 'claude_thinking', ''],
    ['claude-opus-4-8', 'claude', 'claude_thinking', ''],
    ['claude-opus-5', 'claude', 'claude_thinking', ''],
    ['claude-sonnet-4-6', 'claude', 'claude_thinking', ''],
    ['claude-sonnet-5', 'claude', 'claude_thinking', ''],
    ['kimi-k3', 'kimi', 'thinking_object', ''],
    ['kimi-k2.7-code', 'kimi', 'thinking_object', ''],
    ['kimi-k2.5', 'kimi', 'thinking_object', ''],
    ['kimi-k2.6', 'kimi', 'thinking_object', ''],
    ['qwen3.6-flash', 'qwen', 'enable_thinking', ''],
    ['qwen3.6-plus', 'qwen', 'enable_thinking', ''],
    ['qwen3.7-max', 'qwen', 'enable_thinking', ''],
    ['qwen3.7-plus', 'qwen', 'enable_thinking', ''],
    ['qwen-max', 'qwen', 'enable_thinking', ''],
    ['glm-5.1', 'glm', 'thinking_object', ''],
    ['glm-5.2', 'glm', 'thinking_object', 'glm'],
    ['glm-5.2-fast-preview', 'glm', 'thinking_object', 'glm'],
    ['MiniMax-M2.7', 'minimax', 'thinking_object_adaptive', ''],
    ['MiniMax-M2.7-highspeed', 'minimax', 'thinking_object_adaptive', ''],
    ['MiniMax-M3', 'minimax', 'thinking_object_adaptive', ''],
    ['deepseek-v4-flash', 'deepseek', 'thinking_object', 'deepseek'],
    ['deepseek-v4-pro', 'deepseek', 'thinking_object', 'deepseek'],
    ['doubao-seed-2-1-turbo', 'doubao', 'thinking_object', ''],
    ['doubao-seed-2-1-pro', 'doubao', 'thinking_object', '']
];

test('production chat model families expose only their supported thinking controls', () => {
    for (const [model, family, thinkingRequest, reasoningEffortProfile] of EXPECTED_CAPABILITIES) {
        const capability = resolveAiChatModelCapabilities({ model });
        assert.equal(capability.family, family, model);
        assert.equal(capability.supportsThinking, true, model);
        assert.equal(capability.thinkingRequest, thinkingRequest, model);
        assert.equal(capability.reasoningEffortProfile, reasoningEffortProfile, model);
    }
});

test('models without a documented thinking control remain hidden', () => {
    for (const model of [
        'gpt-4o-mini',
        'gemini-2.0-flash',
        'deepseek-chat',
        'qwen-vl-max',
        'qwen-image-plus',
        'doubao-pro-32k',
        'grok-4.20-0309-non-reasoning',
        'grok-composer-2.5-fast',
        'grok-imagine-image',
        'unknown-chat-model'
    ]) {
        const capability = resolveAiChatModelCapabilities({ model });
        assert.equal(capability.supportsThinking, false, model);
        assert.equal(capability.thinkingRequest, '', model);
    }
});

test('model id wins over a broad OpenAI-compatible provider label', () => {
    const capability = resolveAiChatModelCapabilities({
        model: 'qwen3.7-plus',
        vendor: 'openai',
        protocol: 'openai-compatible',
        providerLabel: '国产'
    });
    assert.equal(capability.family, 'qwen');
    assert.equal(capability.thinkingRequest, 'enable_thinking');
});

test('OpenAI reasoning effort choices follow the selected model', () => {
    assert.deepEqual(
        resolveAiChatModelCapabilities({ model: 'gpt-5.4' }).reasoningEfforts,
        ['minimal', 'low', 'medium', 'high', 'xhigh']
    );
    for (const model of ['gpt-5.4-mini', 'gpt-5.5', 'gpt-5.6-sol']) {
        assert.deepEqual(
            resolveAiChatModelCapabilities({ model }).reasoningEfforts,
            ['low', 'medium', 'high', 'xhigh'],
            model
        );
    }
});

test('chat image input requires a verified result for the selected channel', () => {
    const verified = resolveAiChatImageInputPolicy({
        model: 'deepseek-v4-pro',
        providerId: 'channel-2',
        supportsImageInput: true
    });
    assert.equal(verified.status, 'channel_verified');
    assert.equal(verified.available, true);
    assert.deepEqual(verified.formats, ['JPG', 'PNG', 'WebP']);
    assert.equal(verified.maxCount, 16);
    assert.equal(verified.maxFileBytes, 12 * 1024 * 1024);

    const unsupported = resolveAiChatImageInputPolicy({
        model: 'gpt-4.1',
        providerId: 'channel-1',
        supportsImageInput: false
    });
    assert.equal(unsupported.status, 'channel_unsupported');
    assert.equal(unsupported.available, false);
    assert.equal(unsupported.officialSourceLabel, 'OpenAI 官方模型文档');
});

test('official multimodal families remain unavailable until the current channel is verified', () => {
    for (const [model, source] of [
        ['gpt-4.1', 'OpenAI 官方模型文档'],
        ['gemini-2.5-flash', 'Google Gemini 官方模型文档'],
        ['claude-sonnet-4', 'Anthropic Claude 官方视觉文档'],
        ['qwen2.5-vl-72b-instruct', '通义千问官方模型文档']
    ]) {
        const policy = resolveAiChatImageInputPolicy({ model });
        assert.equal(policy.status, 'official_unverified', model);
        assert.equal(policy.available, false, model);
        assert.equal(policy.officialSourceLabel, source, model);
    }
});

test('plain text model families are not treated as official vision models by name alone', () => {
    for (const model of ['deepseek-chat', 'deepseek-v4-pro', 'qwen3.7-plus', 'glm-5.2', 'kimi-k2.5', 'claude-2.1']) {
        const policy = resolveAiChatImageInputPolicy({ model });
        assert.equal(policy.status, 'unverified', model);
        assert.equal(policy.available, false, model);
        assert.equal(policy.officialSourceLabel, '', model);
    }
});

test('Claude image limits use the intersection of official and workbench limits', () => {
    const policy = resolveAiChatImageInputPolicy({
        model: 'claude-sonnet-4',
        supportsImageInput: true
    });
    assert.equal(policy.maxCount, 16);
    assert.equal(policy.officialMaxCount, 20);
    assert.equal(policy.maxFileBytes, 5 * 1024 * 1024);
    assert.equal(policy.workbenchMaxFileBytes, 12 * 1024 * 1024);
});
