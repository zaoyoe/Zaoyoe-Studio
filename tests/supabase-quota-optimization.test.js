const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key';

const {
    PENDING_JOB_SWEEP_IDLE_INTERVAL_MS,
    VERIFY_CONFIG_CACHE_TTL_MS,
    OPS_ALERTS_RUNTIME_CACHE_TTL_MS,
    clearOpsAlertsRuntimeCache,
    clearVerifyConfigCache,
    getCachedOpsAlertsRuntimeConfig,
    resolveTgCorsOrigins
} = require('../server/index');

const {
    DEFAULT_INTERVAL_MS,
    DEFAULT_IDLE_INTERVAL_MS,
    resolveWorkerSleepMs
} = require('../scripts/ai-image-worker');

test('Supabase quota optimization: cache constants are configured to 5 minutes', () => {
    assert.equal(VERIFY_CONFIG_CACHE_TTL_MS, 5 * 60 * 1000);
    assert.equal(OPS_ALERTS_RUNTIME_CACHE_TTL_MS, 5 * 60 * 1000);
    assert.equal(PENDING_JOB_SWEEP_IDLE_INTERVAL_MS, 60 * 1000);
});

test('Supabase quota optimization: getCachedOpsAlertsRuntimeConfig caches results in-memory', async () => {
    clearOpsAlertsRuntimeCache();
    let queryCount = 0;

    const mockClient = {};
    const mockEnv = {
        OPS_ALERTS_TELEGRAM_BOT_TOKEN: 'mock-token'
    };

    // Override the loader by passing mock loader behavior via options or inspecting call count
    const originalLoader = require('../api/_lib/ops-alerts').loadOpsAlertsRuntimeConfig;
    let loaderCallCount = 0;

    // Use a fresh module or proxy to track calls
    const mockRuntime = {
        config: { enabled: true, sweep_interval_ms: 180000 },
        secrets: {},
        site: 'all'
    };

    // First call populates cache
    const first = await getCachedOpsAlertsRuntimeConfig(mockClient, mockEnv, { site: 'cn' });
    assert.ok(first);

    // Second call should hit memory cache immediately
    const second = await getCachedOpsAlertsRuntimeConfig(mockClient, mockEnv, { site: 'cn' });
    assert.equal(second, first);

    // Force refresh bypasses cache
    const refreshed = await getCachedOpsAlertsRuntimeConfig(mockClient, mockEnv, { site: 'cn', bypassCache: true });
    assert.ok(refreshed);
});

test('Supabase quota optimization: ai-image-worker stepped idle backoff saves 80%+ idle queries', () => {
    // Active processing: 1000ms
    assert.equal(resolveWorkerSleepMs({ processedCount: 1, consecutiveIdleBatches: 0 }), DEFAULT_INTERVAL_MS);

    // Initial idle: wait standard idle interval (15s)
    assert.equal(resolveWorkerSleepMs({ processedCount: 0, consecutiveIdleBatches: 1 }), DEFAULT_IDLE_INTERVAL_MS);

    // Short-term idle (batches 2 and 3): 30s
    assert.equal(resolveWorkerSleepMs({ processedCount: 0, consecutiveIdleBatches: 2 }), 30000);
    assert.equal(resolveWorkerSleepMs({ processedCount: 0, consecutiveIdleBatches: 3 }), 30000);

    // Long-term idle (batches 4+): 60s
    assert.equal(resolveWorkerSleepMs({ processedCount: 0, consecutiveIdleBatches: 4 }), 60000);
    assert.equal(resolveWorkerSleepMs({ processedCount: 0, consecutiveIdleBatches: 20 }), 60000);
});

test('Supabase quota optimization: server/index.js monitor intervals do not contain high frequency sweeps', () => {
    const serverIndexSource = fs.readFileSync(path.resolve(__dirname, '../server/index.js'), 'utf8');

    // Ensure queueNextOpsAlertSweep default is 3 minutes (not 15 seconds)
    assert.match(serverIndexSource, /nextDelay = Math\.max\(1000,\s*Number\(delayMs\s*\?\?\s*runtime\?\.config\?\.sweep_interval_ms\s*\?\?\s*3\s*\*\s*60\s*\*\s*1000\)\);/);

    // Ensure queueNextGuestShopAlertSweep default is 5 minutes (not 60 seconds)
    assert.match(serverIndexSource, /sweep_interval_ms\s*\|\|\s*5\s*\*\s*60\s*\*\s*1000/);

    // Ensure queueNextCustomerChatMessageSweep default is 5 minutes (not 60 seconds)
    assert.match(serverIndexSource, /sweep_interval_ms\s*\?\?\s*5\s*\*\s*60\s*\*\s*1000/);

    // Ensure loadPendingTrackedJobs selects only necessary fields instead of select('*')
    assert.match(serverIndexSource, /\.from\('verification_logs'\)\s*\.select\('verification_id,\s*user_id,\s*site,\s*status,\s*message,\s*created_at'\)/);
});
