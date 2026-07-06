#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const {
    runAiImageTaskBatch
} = require('../server/api-handlers/_ai-image-runtime');
const {
    createOpenAiCompatibleImageExecutor
} = require('../server/api-handlers/_ai-image-models');

const DEFAULT_ENV_FILE = path.resolve(__dirname, '../server/.env.production');
const DEFAULT_INTERVAL_MS = 3000;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_BATCH_RETRY_ATTEMPTS = 2;

function parseArgs(argv = []) {
    const options = {
        envFile: DEFAULT_ENV_FILE,
        site: '',
        limit: 8,
        concurrency: DEFAULT_CONCURRENCY,
        concurrencyFromCli: false,
        intervalMs: DEFAULT_INTERVAL_MS,
        once: false,
        json: false
    };

    for (let index = 0; index < argv.length; index += 1) {
        const value = String(argv[index] || '').trim();
        if (!value) continue;

        if (value === '--env-file') {
            options.envFile = path.resolve(process.cwd(), String(argv[index + 1] || '').trim());
            index += 1;
            continue;
        }

        if (value === '--site') {
            const site = String(argv[index + 1] || '').trim().toLowerCase();
            options.site = site === 'cn' || site === 'intl' ? site : '';
            index += 1;
            continue;
        }

        if (value === '--limit') {
            const parsed = Number.parseInt(String(argv[index + 1] || '').trim(), 10);
            if (Number.isFinite(parsed)) {
                options.limit = Math.min(20, Math.max(1, parsed));
            }
            index += 1;
            continue;
        }

        if (value === '--concurrency') {
            const parsed = Number.parseInt(String(argv[index + 1] || '').trim(), 10);
            if (Number.isFinite(parsed)) {
                options.concurrency = Math.min(8, Math.max(1, parsed));
                options.concurrencyFromCli = true;
            }
            index += 1;
            continue;
        }

        if (value === '--interval-ms') {
            const parsed = Number.parseInt(String(argv[index + 1] || '').trim(), 10);
            if (Number.isFinite(parsed)) {
                options.intervalMs = Math.min(60000, Math.max(1000, parsed));
            }
            index += 1;
            continue;
        }

        if (value === '--once') {
            options.once = true;
            continue;
        }

        if (value === '--json') {
            options.json = true;
        }
    }

    return options;
}

function loadEnvFile(envFile) {
    if (!envFile || !fs.existsSync(envFile)) {
        return {};
    }
    return dotenv.parse(fs.readFileSync(envFile, 'utf8'));
}

function applyEnvValues(envValues = {}) {
    Object.entries(envValues || {}).forEach(([key, value]) => {
        if (!key || value === undefined || value === null) return;
        process.env[key] = String(value);
    });
}

function readEnv(envValues = {}, names = []) {
    for (const name of names) {
        const value = String(envValues?.[name] || process.env[name] || '').trim();
        if (value) return value;
    }
    return '';
}

function readPositiveIntEnv(envValues = {}, names = [], fallback = 0, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
    const value = readEnv(envValues, names);
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function requireEnv(envValues = {}, names = []) {
    const value = readEnv(envValues, names);
    if (!value) {
        throw new Error(`Missing required environment variable: ${names.join(' / ')}`);
    }
    return value;
}

function buildSupabaseClient(envValues = {}) {
    return createClient(
        requireEnv(envValues, ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'PUBLIC_SUPABASE_URL']),
        requireEnv(envValues, ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY']),
        {
            auth: {
                persistSession: false,
                autoRefreshToken: false
            }
        }
    );
}

function serializeBatchResult(result = {}) {
    const results = Array.isArray(result.results) ? result.results : [];
    return {
        processed: Number(result.processed || 0),
        succeeded: results.filter((item) => item.task?.status === 'succeeded').length,
        failed: results.filter((item) => item.task?.status === 'failed').length,
        tasks: results.map((item) => ({
            id: item.task?.id || '',
            status: item.task?.status || '',
            mode: item.task?.mode || '',
            billing_mode: item.task?.billing_mode || '',
            charged_points: Number(item.chargedPoints || item.task?.charged_points || 0) || 0,
            result_count: Array.isArray(item.results) ? item.results.length : 0,
            run_ms: Number(item.task?.metadata?.timing?.total_run_ms || 0) || 0,
            executor_ms: Number(item.task?.metadata?.timing?.executor_ms || item.task?.metadata?.executor_ms || 0) || 0,
            upstream_ms: Number(item.task?.metadata?.timing?.upstream_ms || item.task?.metadata?.upstream_ms || 0) || 0,
            postprocess_ms: Number(item.task?.metadata?.timing?.postprocess_ms || item.task?.metadata?.postprocess_ms || 0) || 0,
            runtime_unaccounted_ms: Number(item.task?.metadata?.timing?.runtime_unaccounted_ms || 0) || 0,
            error_code: item.error?.code || item.task?.error_code || '',
            error_message: item.error?.message || item.task?.error_message || ''
        }))
    };
}

function logResult(summary, options = {}) {
    if (options.json) {
        console.log(JSON.stringify({
            at: new Date().toISOString(),
            ...summary
        }));
        return;
    }

    const taskText = summary.tasks.length
        ? summary.tasks.map((task) => {
            const timingText = task.run_ms || task.executor_ms || task.upstream_ms
                ? ` run=${task.run_ms}ms executor=${task.executor_ms}ms upstream=${task.upstream_ms}ms post=${task.postprocess_ms}ms unaccounted=${task.runtime_unaccounted_ms}ms`
                : '';
            return `${task.id}:${task.status}${task.error_code ? `(${task.error_code})` : ''}${timingText}`;
        }).join(', ')
        : 'none';
    console.log(`[${new Date().toISOString()}] processed=${summary.processed} succeeded=${summary.succeeded} failed=${summary.failed} tasks=${taskText}`);
}

function logStartup(options = {}) {
    if (options.json) {
        console.log(JSON.stringify({
            at: new Date().toISOString(),
            event: 'ai_image_worker_start',
            envFile: options.envFile,
            site: options.site || 'all',
            limit: options.limit,
            concurrency: options.concurrency,
            intervalMs: options.intervalMs,
            once: options.once === true
        }));
        return;
    }

    console.log(`[${new Date().toISOString()}] ai-image-worker start envFile=${options.envFile} site=${options.site || 'all'} limit=${options.limit} concurrency=${options.concurrency} intervalMs=${options.intervalMs} once=${options.once === true}`);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeWorkerError(error = {}) {
    const signal = [
        error.name,
        error.code,
        error.message,
        error.cause?.name,
        error.cause?.code,
        error.cause?.message
    ].map((item) => String(item || '').trim()).filter(Boolean).join(' | ');
    const normalized = signal.toLowerCase();
    const code = normalized.includes('timeout') || normalized.includes('abort') || normalized.includes('etimedout')
        ? 'worker_network_timeout'
        : (normalized.includes('enotfound') || normalized.includes('dns')
            ? 'worker_network_dns_failed'
            : (normalized.includes('fetch failed') || normalized.includes('econn') || normalized.includes('socket')
                ? 'worker_network_failed'
                : 'worker_batch_failed'));

    return {
        code,
        message: signal || String(error?.message || error || 'AI image worker batch failed')
    };
}

async function runBatchWithRetry(operation, {
    attempts = DEFAULT_BATCH_RETRY_ATTEMPTS,
    baseDelayMs = 900,
    onRetry
} = {}) {
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            if (attempt >= attempts) break;
            if (typeof onRetry === 'function') {
                onRetry({
                    attempt,
                    attempts,
                    error: normalizeWorkerError(error)
                });
            }
            await sleep(baseDelayMs * attempt);
        }
    }
    throw lastError;
}

async function runWorkerLoop(options = {}) {
    const envValues = loadEnvFile(options.envFile);
    applyEnvValues(envValues);
    const concurrency = options.concurrencyFromCli === true
        ? Math.min(8, Math.max(1, Number(options.concurrency) || DEFAULT_CONCURRENCY))
        : readPositiveIntEnv(envValues, ['AI_IMAGE_WORKER_CONCURRENCY'], options.concurrency || DEFAULT_CONCURRENCY, {
            min: 1,
            max: 8
        });
    const workerOptions = {
        ...options,
        concurrency
    };
    const supabase = buildSupabaseClient(envValues);
    const executor = createOpenAiCompatibleImageExecutor({
        supabase,
        env: {
            ...process.env,
            ...envValues
        }
    });
    let stopping = false;

    const stop = () => {
        stopping = true;
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    logStartup(workerOptions);

    do {
        try {
            const result = await runBatchWithRetry(() => runAiImageTaskBatch({
                supabase,
                site: workerOptions.site,
                limit: workerOptions.limit,
                concurrency: workerOptions.concurrency,
                executor,
                staleRunningTimeoutMs: readPositiveIntEnv(envValues, ['AI_IMAGE_STALE_RUNNING_TIMEOUT_MS'], 3 * 60 * 1000, {
                    min: 60 * 1000,
                    max: 60 * 60 * 1000
                }),
                taskTimeoutMs: readPositiveIntEnv(envValues, ['AI_IMAGE_TASK_TIMEOUT_MS'], 150000, {
                    min: 60 * 1000,
                    max: 30 * 60 * 1000
                }),
                videoTaskTimeoutMs: readPositiveIntEnv(envValues, ['AI_IMAGE_VIDEO_TASK_TIMEOUT_MS', 'AI_VIDEO_TASK_TIMEOUT_MS'], 12 * 60 * 1000, {
                    min: 60 * 1000,
                    max: 30 * 60 * 1000
                }),
                videoStaleRunningTimeoutMs: readPositiveIntEnv(envValues, ['AI_IMAGE_VIDEO_STALE_RUNNING_TIMEOUT_MS', 'AI_VIDEO_STALE_RUNNING_TIMEOUT_MS'], 14 * 60 * 1000, {
                    min: 60 * 1000,
                    max: 40 * 60 * 1000
                })
            }), {
                onRetry: ({ attempt, attempts, error }) => {
                    const message = `retry ${attempt}/${attempts - 1} ${error.code}: ${error.message}`;
                    if (workerOptions.json) {
                        console.warn(JSON.stringify({
                            at: new Date().toISOString(),
                            event: 'ai_image_worker_retry',
                            message
                        }));
                    } else {
                        console.warn(`[${new Date().toISOString()}] ai-image-worker ${message}`);
                    }
                }
            });
            logResult(serializeBatchResult(result), workerOptions);
        } catch (error) {
            const normalized = normalizeWorkerError(error);
            if (workerOptions.json) {
                console.error(JSON.stringify({
                    at: new Date().toISOString(),
                    event: 'ai_image_worker_batch_failed',
                    code: normalized.code,
                    message: normalized.message
                }));
            } else {
                console.error(`[${new Date().toISOString()}] ai-image-worker batch failed ${normalized.code}: ${normalized.message}`);
            }

            if (workerOptions.once) {
                process.exitCode = 1;
                break;
            }
        }

        if (workerOptions.once || stopping) {
            break;
        }

        await sleep(workerOptions.intervalMs);
    } while (!stopping);
}

if (require.main === module) {
    const options = parseArgs(process.argv.slice(2));
    runWorkerLoop(options).catch((error) => {
        console.error(`[AIImageWorker] ${error.message || error}`);
        process.exitCode = 1;
    });
}

module.exports = {
    DEFAULT_CONCURRENCY,
    DEFAULT_INTERVAL_MS,
    applyEnvValues,
    buildSupabaseClient,
    logStartup,
    normalizeWorkerError,
    parseArgs,
    runBatchWithRetry,
    runWorkerLoop,
    serializeBatchResult
};
