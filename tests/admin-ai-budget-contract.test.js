const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('admin ai runtime requires explicit budget tiers and key call sites declare them', () => {
    const adminAiSource = readRepoFile('js/admin-ai.js');
    const adminStudioSource = readRepoFile('admin-studio.js');
    const translateSource = readRepoFile('js/admin-studio-translate.js');
    const analyticsAiSource = readRepoFile('js/admin-analytics-ai-export.js');
    const shopSource = readRepoFile('js/admin-shop.js');
    const geminiHandlerSource = readRepoFile('server/api-handlers/admin/gemini.js');
    const codexHandlerSource = readRepoFile('server/api-handlers/admin/codex.js');

    const requiredMarkers = [
        'requireExplicitTokenBudget(value = null) {',
        "error.code = 'ADMIN_AI_BUDGET_REQUIRED';",
        "message: 'AI budget tier is required for Gemini admin requests'",
        "message: 'AI budget tier is required for Codex admin requests'",
        "tier: 'balanced',\n            maxInputChars: 12000,\n            maxOutputTokens: ADMIN_VISION_ANALYSIS_MAX_OUTPUT_TOKENS",
        "tier: 'lean',\n                maxInputChars: 4000,\n                maxOutputTokens: 256",
        "tier: 'lean',\n                    maxInputChars: 5000,\n                    maxOutputTokens: 1000",
        "tier: 'expanded',\n                    maxInputChars: 24000,\n                    maxOutputTokens: 1600",
        "tier: 'balanced',\n                    maxInputChars: 9000,\n                    maxOutputTokens: 900",
        "tier: 'balanced',\n                maxInputChars: 12000,\n                maxOutputTokens: 1024"
    ];

    const combinedSource = [
        adminAiSource,
        adminStudioSource,
        translateSource,
        analyticsAiSource,
        shopSource,
        geminiHandlerSource,
        codexHandlerSource
    ].join('\n');

    for (const marker of requiredMarkers) {
        assert.equal(combinedSource.includes(marker), true, `budget contract should contain ${marker}`);
    }
});

test('coverage translation preserves temporary provider failures for caller retries', async () => {
    const translateSource = readRepoFile('js/admin-studio-translate.js');
    const providerError = new Error('Service unavailable');
    providerError.status = 503;
    const context = {
        console,
        window: {
            AdminAI: {
                configured: true,
                defaultModel: 'test-model',
                generateText: async () => {
                    throw providerError;
                }
            }
        }
    };

    vm.runInNewContext(translateSource, context);

    await assert.rejects(
        context.window.PromptTranslator.translatePromptFields({
            title: 'English title',
            description: '',
            prompt_text: ''
        }, {
            mode: 'coverage'
        }),
        (error) => error === providerError && error.status === 503
    );
});
