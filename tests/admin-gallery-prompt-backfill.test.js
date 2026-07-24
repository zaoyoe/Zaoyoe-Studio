const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const adminSource = fs.readFileSync(path.resolve(__dirname, '..', 'admin-studio.js'), 'utf8');
const translateSource = fs.readFileSync(path.resolve(__dirname, '..', 'js/admin-studio-translate.js'), 'utf8');

function extractFunction(name) {
    const asyncMarker = `async function ${name}(`;
    const plainMarker = `function ${name}(`;
    const start = adminSource.includes(asyncMarker)
        ? adminSource.indexOf(asyncMarker)
        : adminSource.indexOf(plainMarker);
    assert.notEqual(start, -1, `missing function ${name}`);
    const paramsStart = adminSource.indexOf('(', start);
    let paramsDepth = 0;
    let paramsEnd = -1;
    for (let index = paramsStart; index < adminSource.length; index += 1) {
        if (adminSource[index] === '(') paramsDepth += 1;
        if (adminSource[index] === ')') {
            paramsDepth -= 1;
            if (paramsDepth === 0) {
                paramsEnd = index;
                break;
            }
        }
    }
    assert.notEqual(paramsEnd, -1, `missing params end for ${name}`);
    const bodyStart = adminSource.indexOf('{', paramsEnd);
    assert.notEqual(bodyStart, -1, `missing body for ${name}`);

    let depth = 0;
    let quote = '';
    let escaped = false;
    for (let index = bodyStart; index < adminSource.length; index += 1) {
        const char = adminSource[index];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === '\\') {
            escaped = true;
            continue;
        }
        if (quote) {
            if (char === quote) quote = '';
            continue;
        }
        if (char === '\'' || char === '"' || char === '`') {
            quote = char;
            continue;
        }
        if (char === '{') depth += 1;
        if (char === '}') {
            depth -= 1;
            if (depth === 0) return adminSource.slice(start, index + 1);
        }
    }
    throw new Error(`unterminated function ${name}`);
}

function loadCompletionHelper() {
    const context = {
        console,
        window: {
            AdminAI: {
                configured: true
            }
        }
    };
    vm.runInNewContext(translateSource, context);
    vm.runInNewContext([
        extractFunction('isPublishedPromptTextBackfillComplete'),
        'globalThis.helper = isPublishedPromptTextBackfillComplete;'
    ].join('\n'), context);
    return { helper: context.helper, translator: context.window.PromptTranslator };
}

function loadRetryHelpers(backfillImpl) {
    const context = {
        console,
        backfillPublishedPromptText: backfillImpl
    };
    vm.runInNewContext([
        'const PUBLISHED_PROMPT_BACKFILL_MAX_ATTEMPTS = 3;',
        'const PUBLISHED_PROMPT_BACKFILL_RETRY_BASE_DELAY_MS = 5000;',
        'const PUBLISHED_PROMPT_BACKFILL_RETRY_MAX_DELAY_MS = 60000;',
        'const PUBLISHED_PROMPT_BACKFILL_INITIAL_PARALLELISM = 4;',
        'const PUBLISHED_PROMPT_BACKFILL_MAX_PARALLELISM = 10;',
        'const PUBLISHED_PROMPT_BACKFILL_MIN_PARALLELISM = 1;',
        extractFunction('isPublishedPromptBackfillRetryableError'),
        extractFunction('shouldPausePublishedPromptBackfill'),
        extractFunction('getPublishedPromptBackfillRetryDelayMs'),
        extractFunction('createPublishedPromptBackfillAdaptiveController'),
        extractFunction('waitForPublishedPromptBackfillCooldown'),
        extractFunction('backfillPublishedPromptTextWithRetry'),
        'globalThis.helpers = { isPublishedPromptBackfillRetryableError, shouldPausePublishedPromptBackfill, getPublishedPromptBackfillRetryDelayMs, createPublishedPromptBackfillAdaptiveController, waitForPublishedPromptBackfillCooldown, backfillPublishedPromptTextWithRetry };'
    ].join('\n'), context);
    return context.helpers;
}

function createBatchHarness({ count = 12, failFirstWith = null } = {}) {
    const prompts = Array.from({ length: count }, (_, index) => ({
        id: `prompt-${index + 1}`,
        prompt_text: `Complete source prompt ${index + 1}`,
        prompt_text_en: '',
        prompt_text_zh: ''
    }));
    let active = 0;
    let maxActive = 0;
    let persistedSummary = null;
    const toastMessages = [];
    const context = {
        console: {
            error() {},
            info() {},
            warn() {}
        },
        setImmediate,
        window: {
            AdminAI: { configured: true },
            PromptTranslator: {
                translateCanonicalPromptText() {}
            },
            AdminSiteFilter: {
                requireWritableSite() {
                    return 'cn';
                }
            }
        },
        requireSelectedPromptsForBatch() {
            return prompts;
        },
        isPublishedPromptTextBackfillCandidate() {
            return true;
        },
        isPublishedPromptTextBackfillComplete() {
            return false;
        },
        showAdminStudioToast(message) {
            toastMessages.push(message);
            return null;
        },
        setToastContent() {},
        scheduleToastDismiss() {},
        async checkApiKey() {},
        async backfillPublishedPromptTextWithRetry(prompt) {
            active += 1;
            maxActive = Math.max(maxActive, active);
            try {
                await new Promise((resolve) => setImmediate(resolve));
                if (prompt.id === 'prompt-1' && failFirstWith) throw failFirstWith;
                return { ...prompt, prompt_text_en: prompt.prompt_text, prompt_text_zh: '完整翻译' };
            } finally {
                active -= 1;
            }
        },
        normalizeBatchPromptFailureMessage(error, prompt) {
            return `${prompt.id}: ${error.message}`;
        },
        isPublishedPromptBackfillRetryableError(error) {
            return Number(error?.status || 0) === 429;
        },
        shouldPausePublishedPromptBackfill(error) {
            return [401, 403].includes(Number(error?.status || 0));
        },
        getPublishedPromptBackfillRetryDelayMs() {
            return 5000;
        },
        waitForPublishedPromptBackfillCooldown: async () => {},
        sleep: async () => {},
        markHomepagePromptPoolUpdated() {},
        async loadAdminPrompts() {},
        hydrateAdminGalleryPromptsLocally() {},
        persistPublishedPromptBackfillResult(summary) {
            persistedSummary = { ...summary };
            return persistedSummary;
        }
    };

    vm.runInNewContext([
        'const PUBLISHED_PROMPT_BACKFILL_RETRY_BASE_DELAY_MS = 5000;',
        'const PUBLISHED_PROMPT_BACKFILL_RETRY_MAX_DELAY_MS = 60000;',
        'const PUBLISHED_PROMPT_BACKFILL_MAX_ATTEMPTS = 3;',
        'const PUBLISHED_PROMPT_BACKFILL_MAX_CONSECUTIVE_FAILURES = 5;',
        'const PUBLISHED_PROMPT_BACKFILL_INITIAL_PARALLELISM = 4;',
        'const PUBLISHED_PROMPT_BACKFILL_MAX_PARALLELISM = 10;',
        'const PUBLISHED_PROMPT_BACKFILL_MIN_PARALLELISM = 1;',
        'const PUBLISHED_PROMPT_BACKFILL_LAUNCH_GAP_MS = 250;',
        extractFunction('createPublishedPromptBackfillAdaptiveController'),
        extractFunction('batchBackfillPublishedPromptTexts'),
        'globalThis.runBatch = batchBackfillPublishedPromptTexts;'
    ].join('\n'), context);

    return {
        run: () => context.runBatch(),
        getMaxActive: () => maxActive,
        getSummary: () => persistedSummary,
        toastMessages
    };
}

test('published prompt backfill skips only canonical, structurally complete bilingual rows', () => {
    const { helper, translator } = loadCompletionHelper();
    const source = 'A complete cinematic camera prompt with detailed lighting and subject movement.';

    assert.equal(helper({
        prompt_text: source,
        prompt_text_en: source,
        prompt_text_zh: '包含完整灯光、主体运动和电影镜头说明的提示词。'
    }, translator), true);
    assert.equal(helper({
        prompt_text: source,
        prompt_text_en: 'A short old summary.',
        prompt_text_zh: '旧的简短摘要。'
    }, translator), false);
    assert.equal(helper({
        prompt_text: source,
        prompt_text_en: source,
        prompt_text_zh: ''
    }, translator), false);
});

test('published prompt backfill retries rate limits with bounded exponential delays', async () => {
    let calls = 0;
    const sleepDurations = [];
    const retries = [];
    const helpers = loadRetryHelpers(async () => {
        calls += 1;
        if (calls < 3) {
            const error = new Error('Resource exhausted');
            error.status = 429;
            error.isRateLimited = true;
            throw error;
        }
        return { id: 'prompt-1' };
    });

    const result = await helpers.backfillPublishedPromptTextWithRetry({ id: 'prompt-1' }, 'cn', {
        sleepFn: async (duration) => sleepDurations.push(duration),
        onRetry: (state) => retries.push({ nextAttempt: state.nextAttempt, delayMs: state.delayMs })
    });

    assert.equal(result.id, 'prompt-1');
    assert.equal(calls, 3);
    assert.deepEqual(sleepDurations, [5000, 15000]);
    assert.deepEqual(retries, [
        { nextAttempt: 2, delayMs: 5000 },
        { nextAttempt: 3, delayMs: 15000 }
    ]);
});

test('published prompt backfill does not retry content validation failures', async () => {
    let calls = 0;
    const helpers = loadRetryHelpers(async () => {
        calls += 1;
        throw new Error('完整提示词翻译丢失图片或视频段落');
    });

    await assert.rejects(
        helpers.backfillPublishedPromptTextWithRetry({ id: 'prompt-2' }, 'cn', {
            sleepFn: async () => assert.fail('content failures should not sleep')
        }),
        /丢失图片或视频段落/
    );
    assert.equal(calls, 1);
});

test('published prompt backfill adaptive controller grows on success and halves on pressure', async () => {
    let now = 1000;
    const helpers = loadRetryHelpers(async () => ({ id: 'unused' }));
    const controller = helpers.createPublishedPromptBackfillAdaptiveController(20, {
        initial: 4,
        ceiling: 10,
        nowFn: () => now
    });

    assert.equal(controller.limit, 4);
    for (let index = 0; index < 4; index += 1) controller.observeSuccess();
    assert.equal(controller.limit, 5);
    assert.equal(controller.peakLimit, 5);

    const pressure = controller.observePressure({ retryAfterMs: 30000 }, 5000);
    assert.equal(pressure.previousLimit, 5);
    assert.equal(controller.limit, 2);
    assert.equal(controller.getCooldownRemainingMs(), 30000);
    controller.observeSuccess();
    assert.equal(controller.limit, 2, 'successes during cooldown must not immediately restore pressure');

    const sleeps = [];
    await helpers.waitForPublishedPromptBackfillCooldown(controller, async (duration) => {
        sleeps.push(duration);
        now += duration;
    });
    assert.deepEqual(sleeps, [30000]);
    controller.observeSuccess();
    controller.observeSuccess();
    assert.equal(controller.limit, 3);
    assert.equal(controller.pressureEvents, 1);
});

test('published prompt backfill shares adaptive cooldown instead of adding a second local sleep', async () => {
    let calls = 0;
    const sharedWaits = [];
    const helpers = loadRetryHelpers(async () => {
        calls += 1;
        if (calls === 1) {
            const error = new Error('429 rate limit');
            error.status = 429;
            throw error;
        }
        return { id: 'prompt-3' };
    });

    const result = await helpers.backfillPublishedPromptTextWithRetry({ id: 'prompt-3' }, 'cn', {
        sleepFn: async () => assert.fail('shared retry wait should replace local sleep'),
        onRetry: async ({ delayMs }) => {
            sharedWaits.push(delayMs);
        }
    });

    assert.equal(result.id, 'prompt-3');
    assert.equal(calls, 2);
    assert.deepEqual(sharedWaits, [5000]);
});

test('published prompt backfill keeps retryable pressure adaptive but pauses fatal auth errors', () => {
    const helpers = loadRetryHelpers(async () => ({ id: 'unused' }));
    assert.equal(helpers.shouldPausePublishedPromptBackfill({ status: 429, message: 'quota' }), false);
    assert.equal(helpers.shouldPausePublishedPromptBackfill({ status: 401, message: 'Unauthorized' }), true);
    assert.equal(helpers.shouldPausePublishedPromptBackfill({ message: 'Gemini API Key 未配置' }), true);
});

test('published prompt backfill batch expands concurrent work after stable completions', async () => {
    const harness = createBatchHarness({ count: 12 });

    assert.equal(await harness.run(), true);
    assert.ok(harness.getMaxActive() >= 4, `expected at least four concurrent tasks, got ${harness.getMaxActive()}`);
    assert.ok(harness.getMaxActive() <= 10);
    assert.equal(harness.getSummary().updatedCount, 12);
    assert.equal(harness.getSummary().remainingCount, 0);
    assert.ok(harness.getSummary().peakParallelism > 4);
});

test('published prompt backfill stops launching after fatal auth errors and drains in-flight work', async () => {
    const authError = new Error('Unauthorized');
    authError.status = 401;
    const harness = createBatchHarness({ count: 12, failFirstWith: authError });

    assert.equal(await harness.run(), false);
    assert.equal(harness.getMaxActive(), 4);
    assert.equal(harness.getSummary().paused, true);
    assert.equal(harness.getSummary().processedCount, 4);
    assert.equal(harness.getSummary().updatedCount, 3);
    assert.equal(harness.getSummary().failedCount, 1);
    assert.equal(harness.getSummary().remainingCount, 8);
});

test('published prompt backfill reports paused and remaining counts instead of fake completion', () => {
    for (const marker of [
        'const pendingPrompts = publishedPrompts.filter((prompt) => !isPublishedPromptTextBackfillComplete(prompt));',
        'const adaptiveController = createPublishedPromptBackfillAdaptiveController(pendingPrompts.length);',
        'const runningTasks = new Set();',
        'runningTasks.size < adaptiveController.limit',
        'adaptiveController.observePressure(error, delayMs)',
        'if (shouldPausePublishedPromptBackfill(error)',
        'const remainingCount = Math.max(0, pendingPrompts.length - processedCount);',
        '`回填已暂停：成功 ${updatedRows.length} 条，失败 ${failures.length} 条${skippedSuffix}，未处理 ${remainingCount} 条，峰值并发 ${result.peakParallelism}；${pauseFailureMessage || failures[0] || \'请稍后重试\'}`',
        'PUBLISHED_PROMPT_BACKFILL_RESULT_STORAGE_KEY'
    ]) {
        assert.equal(adminSource.includes(marker), true, `admin-studio.js should contain ${marker}`);
    }
});
