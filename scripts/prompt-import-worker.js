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

async function main() {
    loadEnvironment();
    const supabase = createSupabase();
    const workerName = process.env.PROMPT_IMPORT_WORKER_NAME || `prompt-import:${os.hostname()}:${process.pid}`;
    const concurrencyCeiling = Math.min(10, Math.max(1, Number(process.env.PROMPT_IMPORT_WORKER_CONCURRENCY || 10)));
    let adaptiveLimit = Math.min(6, concurrencyCeiling);
    const intervalMs = Math.max(1000, Number(process.env.PROMPT_IMPORT_WORKER_INTERVAL_MS || 2000));
    const once = process.argv.includes('--once');
    let stopping = false;
    process.once('SIGINT', () => { stopping = true; });
    process.once('SIGTERM', () => { stopping = true; });
    do {
        try {
            const result = await runPromptImportWorkerBatch(supabase, { workerName, limit: adaptiveLimit, leaseSeconds: 300 });
            const rejected = result.results.filter((entry) => entry.status === 'rejected');
            const hasPressure = rejected.some((entry) => /429|5\d\d|timeout|timed out|fetch failed|network|gateway|rate limit/i.test(String(entry.reason?.message || entry.reason || '')));
            if (hasPressure) {
                adaptiveLimit = Math.max(1, Math.floor(adaptiveLimit / 2));
                await new Promise((resolve) => setTimeout(resolve, 6000));
            } else if (result.claimed >= adaptiveLimit && rejected.length === 0 && adaptiveLimit < concurrencyCeiling) {
                adaptiveLimit += 1;
            }
            if (result.claimed) console.log(`[${new Date().toISOString()}] claimed=${result.claimed} fulfilled=${result.results.filter((entry) => entry.status === 'fulfilled').length} adaptive=${adaptiveLimit}/${concurrencyCeiling}`);
        } catch (error) {
            console.error(`[${new Date().toISOString()}] prompt-import-worker: ${error.message || error}`);
            if (once) process.exitCode = 1;
        }
        if (!once && !stopping) await new Promise((resolve) => setTimeout(resolve, intervalMs));
    } while (!once && !stopping);
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });

module.exports = { main };
