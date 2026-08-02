const test = require('node:test');
const assert = require('node:assert/strict');

const {
    resolveAiChatModelCapabilities
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
