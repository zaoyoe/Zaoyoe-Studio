#!/usr/bin/env node
'use strict';

function parseArgs(argv = []) {
    let retentionDays = 7;
    let batchSize = 200;
    let dryRun = false;
    let maxBatches = 20;
    const positiveInteger = value => /^\d+$/.test(value || '') && Number.isSafeInteger(Number(value)) && Number(value) > 0;

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--dry-run') {
            dryRun = true;
            continue;
        }
        if (arg === '--days' || arg === '-d') {
            const nextVal = positiveInteger(argv[index + 1]) ? Number(argv[index + 1]) : NaN;
            if (Number.isInteger(nextVal) && nextVal >= 1) {
                retentionDays = nextVal;
                index += 1;
                continue;
            }
            throw new Error('Invalid --days value, must be a positive integer');
        }
        if (arg === '--batch' || arg === '-b') {
            const nextVal = positiveInteger(argv[index + 1]) ? Number(argv[index + 1]) : NaN;
            if (Number.isInteger(nextVal) && nextVal >= 1 && nextVal <= 1000) {
                batchSize = nextVal;
                index += 1;
                continue;
            }
            throw new Error('Invalid --batch value, must be an integer between 1 and 1000');
        }
        if (arg === '--max-batches') {
            const value = argv[++index];
            if (!positiveInteger(value) || Number(value) > 100) throw new Error('Invalid --max-batches value');
            maxBatches = Number(value);
            continue;
        }
        throw new Error('Unknown maintenance argument');
    }

    return { retentionDays, batchSize, dryRun, maxBatches };
}

async function runShredder({
    argv = process.argv.slice(2),
    env = process.env,
    databaseFactory
} = {}) {
    const { retentionDays, batchSize, dryRun, maxBatches } = parseArgs(argv);

    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    }

    const buildClient = databaseFactory || ((url, key) => {
        const { createClient } = require('@supabase/supabase-js');
        return createClient(url, key, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
        });
    });

    const supabase = buildClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

    async function countCandidates() {
        // SELECT also sees candidates skipped by the RPC's SKIP LOCKED.
        const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
        const { count, error } = await supabase
            .from('shop_cdk_secrets')
            .select('inventory_id', { count: 'exact', head: true })
            .not('delivered_at', 'is', null)
            .lt('delivered_at', cutoffDate)
            .neq('ciphertext', 'SHREDDED');

        if (error) {
            throw new Error('Candidate count query failed');
        }

        if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid candidate count');
        return count;
    }

    if (dryRun) {
        const count = await countCandidates();
        return {
            success: true,
            dryRun: true,
            candidateCount: count,
            retentionDays,
            batchSize
        };
    }

    let shreddedCount = 0;
    for (let batch = 1; batch <= maxBatches; batch++) {
        const { data, error } = await supabase.rpc('fn_shred_expired_cdks', {
            p_retention_days: retentionDays, p_max_batch_size: batchSize
        });
        if (error) throw new Error('Ciphertext clearing RPC failed');
        const row = Array.isArray(data) && data.length === 1 ? data[0] : null;
        const count = row?.shredded_count;
        if (!Number.isSafeInteger(count) || count < 0 || count > batchSize) throw new Error('Invalid clearing result');
        shreddedCount += count;
        if (count < batchSize) {
            // A short batch may have skipped locked rows. Only a separate, valid
            // read proving zero candidates can mark this run complete.
            const remainingCandidates = await countCandidates();
            return { success: remainingCandidates === 0, status: remainingCandidates === 0 ? 'PASS' : 'INCOMPLETE',
                dryRun: false, shreddedCount, retentionDays, batchSize, batches: batch, remainingCandidates,
                ...(remainingCandidates > 0 ? { reason: 'candidates_remaining' } : {}) };
        }
    }
    // A full final batch does not establish that the backlog is empty.
    return { success: false, status: 'INCOMPLETE', dryRun: false, shreddedCount, retentionDays, batchSize,
        batches: maxBatches, reason: 'batch_limit_reached' };

}

if (require.main === module) {
    runShredder().then((result) => {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        process.exitCode = result.success ? 0 : 2;
    }).catch((error) => {
        process.stderr.write(`${JSON.stringify({ success: false, error: 'Ciphertext maintenance could not complete' })}\n`);
        process.exitCode = 1;
    });
}

module.exports = {
    parseArgs,
    runShredder
};
