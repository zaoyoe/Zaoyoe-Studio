const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

const aiBudget = require('../server/api-handlers/admin/_ai-shared');

function getProtectedSourceChunk(prompt = '') {
    return String(prompt).split('Source prompt chunk:\n').pop();
}

function translateProtectedTestChunk(prompt = '') {
    return getProtectedSourceChunk(prompt)
        .replace(/Detailed visual instruction\. ?/g, '详细视觉指令。')
        .replace(/Detailed camera direction\. ?/g, '详细镜头说明。')
        .replace(/tracking shot\./g, '跟拍镜头。');
}

test('admin ai longform budget supports complete prompt backfills', () => {
    assert.deepEqual(aiBudget.resolveRequestBudget({
        tier: 'longform',
        maxInputChars: 24000,
        maxOutputTokens: 8192
    }), {
        tier: 'longform',
        maxInputChars: 24000,
        maxOutputTokens: 8192
    });
});

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
        "tier: 'longform',\n            maxInputChars: 24000,\n            maxOutputTokens: 8192",
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

test('published prompt backfill uses longform budget and preserves canonical structure', async () => {
    const translateSource = readRepoFile('js/admin-studio-translate.js');
    const calls = [];
    const context = {
        console,
        window: {
            AdminAI: {
                configured: true,
                defaultModel: 'test-model',
                generateText: async (prompt, options) => {
                    calls.push({ prompt, options });
                    return translateProtectedTestChunk(prompt);
                }
            }
        }
    };
    vm.runInNewContext(translateSource, context);
    const source = `[IMAGE · 1]\n${'Detailed visual instruction. '.repeat(20)}\n[VIDEO · 2]\n00:00-00:05 P01 16:9 tracking shot.`;
    const result = await context.window.PromptTranslator.translateCanonicalPromptText(source);

    assert.equal(result.prompt_text_en, source);
    assert.equal(result.prompt_text_zh, `[IMAGE · 1]\n${'详细视觉指令。'.repeat(20)}\n[VIDEO · 2]\n00:00-00:05 P01 16:9 跟拍镜头。`);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.budget.tier, 'longform');
    assert.equal(calls[0].options.budget.maxOutputTokens, 8192);
});

test('published prompt backfill rejects a summarized translation', async () => {
    const translateSource = readRepoFile('js/admin-studio-translate.js');
    const context = {
        console,
        window: {
            AdminAI: {
                configured: true,
                defaultModel: 'test-model',
                generateText: async (prompt) => {
                    const placeholders = getProtectedSourceChunk(prompt).match(/__FK_CANONICAL_TOKEN_\d{4}__/g) || [];
                    return `${placeholders.join(' ')}\n简短摘要。`;
                }
            }
        }
    };
    vm.runInNewContext(translateSource, context);
    const source = `[IMAGE · 1]\n${'Detailed visual instruction. '.repeat(20)}\n[VIDEO · 2]\n00:00-00:05 P01 tracking shot.`;

    await assert.rejects(
        context.window.PromptTranslator.translateCanonicalPromptText(source),
        /丢失图片或视频段落|明显短于源提示词/
    );
});

test('published prompt backfill splits long prompts at media boundaries and validates the merged result', async () => {
    const translateSource = readRepoFile('js/admin-studio-translate.js');
    const calls = [];
    const context = {
        console,
        window: {
            AdminAI: {
                configured: true,
                defaultModel: 'test-model',
                generateText: async (prompt, options) => {
                    calls.push({ prompt, options });
                    return translateProtectedTestChunk(prompt);
                }
            }
        }
    };
    vm.runInNewContext(translateSource, context);
    const translator = context.window.PromptTranslator;
    const source = [
        `[IMAGE · 1]\n${'Detailed camera direction. '.repeat(125)}`,
        `[IMAGE · 2]\n${'Detailed camera direction. '.repeat(125)}`,
        `[VIDEO · 3]\n00:00-00:05 P01 ${'Detailed camera direction. '.repeat(125)}`
    ].join('\n\n');
    const chunks = translator.splitCanonicalPromptText(source);
    assert.ok(chunks.length > 1);
    assert.ok(chunks.every((chunk) => chunk.length <= 4200));
    assert.equal(chunks[1].startsWith('[IMAGE · 2]'), true);

    const originalValidate = translator.validateCanonicalPromptTranslation.bind(translator);
    let mergedValidationCount = 0;
    translator.validateCanonicalPromptTranslation = (sourceText, translatedText) => {
        if (sourceText === source.trim()) mergedValidationCount += 1;
        return originalValidate(sourceText, translatedText);
    };
    const result = await translator.translateCanonicalPromptText(source);

    assert.equal(calls.length, chunks.length);
    assert.equal(mergedValidationCount, 1);
    assert.deepEqual(
        Array.from(translator.extractCanonicalMediaHeaders(result.prompt_text_zh)),
        ['[IMAGE · 1]', '[IMAGE · 2]', '[VIDEO · 3]']
    );
});

test('published prompt backfill protects exact timing, layout, shot, and numeric markers', async () => {
    const translateSource = readRepoFile('js/admin-studio-translate.js');
    const calls = [];
    const context = {
        console,
        window: {
            AdminAI: {
                configured: true,
                defaultModel: 'test-model',
                generateText: async (prompt) => {
                    calls.push(prompt);
                    return getProtectedSourceChunk(prompt).replace(/Detailed camera direction\./g, '详细镜头说明。');
                }
            }
        }
    };
    vm.runInNewContext(translateSource, context);
    const source = '[VIDEO · 2]\n00:00-00:05 P01 P## 1-2 seconds 0-2.5s 1.2s 16:9 85% ISO 800 f/2.8 Detailed camera direction.';
    const result = await context.window.PromptTranslator.translateCanonicalPromptText(source);

    for (const token of ['[VIDEO · 2]', '00:00-00:05', 'P01', 'P##', '1-2 seconds', '0-2.5s', '1.2s', '16:9', '85%', '800', '2.8']) {
        assert.equal(result.prompt_text_zh.includes(token), true, `translated prompt should preserve ${token}`);
    }
    assert.equal(calls.length, 1);
    assert.equal(calls[0].includes('[VIDEO · 2]'), false);
    assert.equal(calls[0].includes('1-2 seconds'), false);
    assert.equal(calls[0].includes('0-2.5s'), false);
    assert.equal(calls[0].includes('1.2s'), false);
    assert.equal(calls[0].includes('85%'), false);
});

test('published prompt backfill allows numeric placeholders to move for natural grammar', () => {
    const translateSource = readRepoFile('js/admin-studio-translate.js');
    const context = { console, window: { AdminAI: { configured: true } } };
    vm.runInNewContext(translateSource, context);
    const translator = context.window.PromptTranslator;
    const protection = translator.protectCanonicalPromptTokens('Start at 1.2s and hold for 15 seconds.');
    const placeholders = protection.tokens.map((token) => token.placeholder);
    const reordered = `持续 ${placeholders[1]}，从 ${placeholders[0]} 开始。`;
    const restored = translator.restoreCanonicalPromptTokens(reordered, protection);

    assert.equal(restored, '持续 15 seconds，从 1.2s 开始。');
});

test('published prompt backfill still rejects reordered media section headers', async () => {
    const translateSource = readRepoFile('js/admin-studio-translate.js');
    const context = {
        console,
        window: {
            AdminAI: {
                configured: true,
                defaultModel: 'test-model',
                generateText: async (prompt) => {
                    const chunk = getProtectedSourceChunk(prompt);
                    const placeholders = chunk.match(/__FK_CANONICAL_TOKEN_\d{4}__/g) || [];
                    return chunk
                        .replace(placeholders[0], '__TEMP_TOKEN__')
                        .replace(placeholders[1], placeholders[0])
                        .replace('__TEMP_TOKEN__', placeholders[1]);
                }
            }
        }
    };
    vm.runInNewContext(translateSource, context);
    const source = `[IMAGE · 1]\n${'Detailed visual instruction. '.repeat(14)}\n[VIDEO · 2]\n${'Detailed camera direction. '.repeat(14)}`;

    await assert.rejects(
        context.window.PromptTranslator.translateCanonicalPromptText(source),
        /丢失图片或视频段落/
    );
});

test('published prompt backfill retries only a chunk that fails content validation', async () => {
    const translateSource = readRepoFile('js/admin-studio-translate.js');
    const callCounts = new Map();
    const context = {
        console,
        window: {
            AdminAI: {
                configured: true,
                defaultModel: 'test-model',
                generateText: async (prompt) => {
                    const chunk = getProtectedSourceChunk(prompt);
                    const chunkName = ['ALPHA', 'BETA', 'GAMMA'].find((name) => chunk.includes(name));
                    callCounts.set(chunkName, (callCounts.get(chunkName) || 0) + 1);
                    if (chunkName === 'BETA' && callCounts.get(chunkName) === 1) return '过短';
                    return chunk.replace(new RegExp(chunkName, 'g'), `已翻译${chunkName}`);
                }
            }
        }
    };
    vm.runInNewContext(translateSource, context);
    const chunks = ['ALPHA', 'BETA', 'GAMMA'].map((name) => `${name} ${'Detailed camera direction. '.repeat(18)}`);
    const results = await context.window.PromptTranslator.translateCanonicalPromptChunks(chunks, 'Chinese', {
        parallelism: 3,
        maxAttempts: 3
    });

    assert.equal(results.length, 3);
    assert.equal(callCounts.get('ALPHA'), 1);
    assert.equal(callCounts.get('BETA'), 2);
    assert.equal(callCounts.get('GAMMA'), 1);
});

test('published prompt backfill propagates provider pressure without chunk retries', async () => {
    const translateSource = readRepoFile('js/admin-studio-translate.js');
    const providerError = new Error('Service unavailable');
    providerError.status = 503;
    let calls = 0;
    const context = {
        console,
        window: {
            AdminAI: {
                configured: true,
                defaultModel: 'test-model',
                generateText: async () => {
                    calls += 1;
                    throw providerError;
                }
            }
        }
    };
    vm.runInNewContext(translateSource, context);

    await assert.rejects(
        context.window.PromptTranslator.translateCanonicalPromptText('A complete detailed camera direction for a cinematic tracking shot.'),
        (error) => error === providerError && error.status === 503
    );
    assert.equal(calls, 1);
});
