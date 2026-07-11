#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { runPromptImportWorkerBatch } = require('../server/workers/prompt-import-runtime');

function readArg(name, fallback = '') {
    const index = process.argv.indexOf(name);
    return index >= 0 ? String(process.argv[index + 1] || fallback) : fallback;
}

function loadEnvironment() {
    const envFile = path.resolve(readArg('--env-file', path.resolve(__dirname, '../server/.env.production')));
    if (fs.existsSync(envFile)) Object.assign(process.env, dotenv.parse(fs.readFileSync(envFile, 'utf8')));
}

function createSupabase() {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) throw new Error('Missing Supabase service credentials');
    return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function createAdaptiveConcurrencyController({ ceiling = 10, initial = 3, stableBatchesRequired = 2 } = {}) {
    const normalizedCeiling = Math.min(20, Math.max(1, Number(ceiling || 10)));
    let limit = Math.min(normalizedCeiling, Math.max(1, Number(initial || 3)));
    let stableBatches = 0;
    return {
        get limit() {
            return limit;
        },
        observe({ claimed = 0, fulfilled = 0, rejected = [] } = {}) {
            const pressureFailures = rejected.filter((entry) => entry.reason?.retryable === true
                || /429|5\d\d|timeout|timed out|fetch failed|network|gateway|rate limit/i.test(String(entry.reason?.message || entry.reason || '')));
            if (pressureFailures.length) {
                limit = Math.max(1, Math.floor(limit / 2));
                stableBatches = 0;
                const retryAfterMs = pressureFailures.reduce(
                    (maximum, entry) => Math.max(maximum, Number(entry.reason?.retryAfterMs || 0)),
                    0
                );
                return { limit, pressure: true, cooldownMs: Math.max(15000, retryAfterMs) };
            }
            if (rejected.length || claimed < limit || fulfilled < claimed) {
                stableBatches = 0;
                return { limit, pressure: false, cooldownMs: 0 };
            }
            stableBatches += 1;
            if (stableBatches >= Math.max(1, Number(stableBatchesRequired || 2)) && limit < normalizedCeiling) {
                limit += 1;
                stableBatches = 0;
            }
            return { limit, pressure: false, cooldownMs: 0 };
        }
    };
}

async function main() {
    loadEnvironment();
    const supabase = createSupabase();
    const workerName = process.env.PROMPT_IMPORT_WORKER_NAME || `prompt-import:${os.hostname()}:${process.pid}`;
    const concurrencyCeiling = Math.min(20, Math.max(1, Number(process.env.PROMPT_IMPORT_WORKER_CONCURRENCY || 10)));
    const controller = createAdaptiveConcurrencyController({
        ceiling: concurrencyCeiling,
        initial: Number(process.env.PROMPT_IMPORT_WORKER_INITIAL_CONCURRENCY || 3)
    });
    const intervalMs = Math.max(1000, Number(process.env.PROMPT_IMPORT_WORKER_INTERVAL_MS || 2000));
    const once = process.argv.includes('--once');
    let stopping = false;
    process.once('SIGINT', () => { stopping = true; });
    process.once('SIGTERM', () => { stopping = true; });
    do {
        try {
            const activeLimit = controller.limit;
            const result = await runPromptImportWorkerBatch(supabase, { workerName, limit: activeLimit, leaseSeconds: 300 });
            const rejected = result.results.filter((entry) => entry.status === 'rejected');
            result.results.forEach((entry, index) => {
                if (entry.status !== 'rejected') return;
                const item = result.items?.[index];
                console.error(`[${new Date().toISOString()}] item=${item?.id || 'unknown'} stage=${item?.pipeline_stage || 'processing'} failed: ${entry.reason?.message || entry.reason}`);
            });
            const fulfilled = result.results.filter((entry) => entry.status === 'fulfilled').length;
            const adaptive = controller.observe({ claimed: result.claimed, fulfilled, rejected });
            if (adaptive.pressure) await new Promise((resolve) => setTimeout(resolve, adaptive.cooldownMs));
            if (result.claimed) console.log(`[${new Date().toISOString()}] claimed=${result.claimed} fulfilled=${fulfilled} adaptive=${adaptive.limit}/${concurrencyCeiling}`);
        } catch (error) {
            console.error(`[${new Date().toISOString()}] prompt-import-worker: ${error.message || error}`);
            if (once) process.exitCode = 1;
        }
        if (!once && !stopping) await new Promise((resolve) => setTimeout(resolve, intervalMs));
    } while (!once && !stopping);
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });

module.exports = { createAdaptiveConcurrencyController, main };
