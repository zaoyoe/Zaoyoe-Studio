const test = require('node:test');
const assert = require('node:assert/strict');

const {
    DEFAULT_CONCURRENCY,
    DEFAULT_INTERVAL_MS,
    applyEnvValues,
    logStartup,
    normalizeWorkerError,
    parseArgs,
    runBatchWithRetry,
    serializeBatchResult
} = require('../scripts/ai-image-worker');

test('ai image worker parses safe bounded runtime options', () => {
    const parsed = parseArgs([
        '--site', 'intl',
        '--limit', '99',
        '--concurrency', '99',
        '--interval-ms', '25',
        '--once',
        '--json',
        '--env-file', 'server/.env.worker'
    ]);

    assert.equal(parsed.site, 'intl');
    assert.equal(parsed.limit, 20);
    assert.equal(parsed.concurrency, 8);
    assert.equal(parsed.concurrencyFromCli, true);
    assert.equal(parsed.intervalMs, 1000);
    assert.equal(parsed.once, true);
    assert.equal(parsed.json, true);
    assert.match(parsed.envFile, /server\/\.env\.worker$/);
});

test('ai image worker defaults to continuous preview-first batch mode', () => {
    const parsed = parseArgs([]);

    assert.equal(parsed.site, '');
    assert.equal(parsed.limit, 8);
    assert.equal(parsed.concurrency, DEFAULT_CONCURRENCY);
    assert.equal(parsed.concurrencyFromCli, false);
    assert.equal(DEFAULT_INTERVAL_MS, 1000);
    assert.equal(parsed.intervalMs, DEFAULT_INTERVAL_MS);
    assert.equal(parsed.once, false);
    assert.equal(parsed.json, false);
});

test('ai image worker applies env-file values to process env for stored secret decryption', () => {
    const originalEncryptionKey = process.env.ADMIN_CONFIG_ENCRYPTION_KEY;
    const originalInlineFlag = process.env.AI_IMAGE_ALLOW_INLINE_DATA_URLS;

    try {
        delete process.env.ADMIN_CONFIG_ENCRYPTION_KEY;
        delete process.env.AI_IMAGE_ALLOW_INLINE_DATA_URLS;

        applyEnvValues({
            ADMIN_CONFIG_ENCRYPTION_KEY: 'local-worker-secret',
            AI_IMAGE_ALLOW_INLINE_DATA_URLS: true
        });

        assert.equal(process.env.ADMIN_CONFIG_ENCRYPTION_KEY, 'local-worker-secret');
        assert.equal(process.env.AI_IMAGE_ALLOW_INLINE_DATA_URLS, 'true');
    } finally {
        if (originalEncryptionKey === undefined) {
            delete process.env.ADMIN_CONFIG_ENCRYPTION_KEY;
        } else {
            process.env.ADMIN_CONFIG_ENCRYPTION_KEY = originalEncryptionKey;
        }

        if (originalInlineFlag === undefined) {
            delete process.env.AI_IMAGE_ALLOW_INLINE_DATA_URLS;
        } else {
            process.env.AI_IMAGE_ALLOW_INLINE_DATA_URLS = originalInlineFlag;
        }
    }
});

test('ai image worker serializes batch billing and task outcomes for logs', () => {
    const summary = serializeBatchResult({
        processed: 2,
        results: [
            {
                task: {
                    id: 'task-ok',
                    status: 'succeeded',
                    mode: 'text',
                    billing_mode: 'points',
                    charged_points: 8,
                    metadata: {
                        timing: {
                            total_run_ms: 82000,
                            executor_ms: 79000,
                            upstream_ms: 73000,
                            postprocess_ms: 3000,
                            runtime_unaccounted_ms: 0
                        }
                    }
                },
                results: [{ id: 'image-1' }],
                chargedPoints: 8
            },
            {
                task: {
                    id: 'task-fail',
                    status: 'failed',
                    mode: 'text',
                    billing_mode: 'points',
                    charged_points: 0,
                    error_code: 'ai_image_model_not_configured',
                    error_message: 'missing config'
                },
                results: []
            }
        ]
    });

    assert.equal(summary.processed, 2);
    assert.equal(summary.succeeded, 1);
    assert.equal(summary.failed, 1);
    assert.equal(summary.tasks[0].charged_points, 8);
    assert.equal(summary.tasks[0].result_count, 1);
    assert.equal(summary.tasks[0].run_ms, 82000);
    assert.equal(summary.tasks[0].executor_ms, 79000);
    assert.equal(summary.tasks[0].upstream_ms, 73000);
    assert.equal(summary.tasks[0].postprocess_ms, 3000);
    assert.equal(summary.tasks[0].runtime_unaccounted_ms, 0);
    assert.equal(summary.tasks[1].error_code, 'ai_image_model_not_configured');
});

test('ai image worker classifies transient fetch failures for retry logs', () => {
    const cause = new Error('connect ETIMEDOUT 203.0.113.1:443');
    cause.code = 'ETIMEDOUT';
    const error = new TypeError('fetch failed');
    error.cause = cause;

    const normalized = normalizeWorkerError(error);

    assert.equal(normalized.code, 'worker_network_timeout');
    assert.match(normalized.message, /ETIMEDOUT/);
});

test('ai image worker retries transient batch failures', async () => {
    const retries = [];
    let attempts = 0;
    const result = await runBatchWithRetry(async () => {
        attempts += 1;
        if (attempts === 1) {
            throw new TypeError('fetch failed');
        }
        return { processed: 0, results: [] };
    }, {
        attempts: 2,
        baseDelayMs: 1,
        onRetry: (payload) => retries.push(payload)
    });

    assert.equal(attempts, 2);
    assert.equal(retries.length, 1);
    assert.equal(retries[0].error.code, 'worker_network_failed');
    assert.equal(result.processed, 0);
});

test('ai image worker startup log omits secrets', () => {
    const originalLog = console.log;
    const lines = [];
    console.log = (line) => lines.push(String(line || ''));

    try {
        logStartup({
            json: true,
            envFile: 'server/.env.production',
            site: 'cn',
            limit: 2,
            concurrency: 3,
            intervalMs: 5000,
            once: false,
            AI_IMAGE_API_KEY: 'sk-secret'
        });
    } finally {
        console.log = originalLog;
    }

    assert.equal(lines.length, 1);
    const payload = JSON.parse(lines[0]);
    assert.equal(payload.event, 'ai_image_worker_start');
    assert.equal(payload.site, 'cn');
    assert.equal(payload.limit, 2);
    assert.equal(payload.concurrency, 3);
    assert.equal(JSON.stringify(payload).includes('sk-secret'), false);
});
