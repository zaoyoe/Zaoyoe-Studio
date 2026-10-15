#!/usr/bin/env node
'use strict';

const { createTgWorker, enabled } = require('../server/tg/worker');
const { createGramixClient } = require('../server/tg/gramix-client');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseArgs(argv = []) {
    let orderId = null;
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--once') continue;
        if (arg === '--order-id' && orderId === null && UUID_PATTERN.test(String(argv[index + 1] || ''))) {
            orderId = argv[index + 1].toLowerCase();
            index += 1;
            continue;
        }
        throw Object.assign(new Error('Invalid TG worker arguments'), { code: 'tg_worker_invalid_arguments' });
    }
    return { orderId };
}

async function runCli({ argv = process.argv.slice(2), env = process.env, databaseFactory, clientFactory = createGramixClient } = {}) {
    const options = parseArgs(argv);
    // A dry/default invocation must not need secrets or instantiate clients.
    if (!enabled(env.TG_FULFILLMENT_ENABLED)) return { success: true, processed: false, disabled: true };
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
        throw Object.assign(new Error('TG worker database is not configured'), { code: 'tg_worker_configuration_error' });
    }
    const buildDatabase = databaseFactory || ((url, key) => require('@supabase/supabase-js').createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    }));
    // Validate provider configuration before claiming an entitlement. The
    // actual purchase still requires the durable database submission marker.
    const client = clientFactory({ env });
    const supabase = buildDatabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    return createTgWorker({ supabase, client, env }).runOnce(options);
}

if (require.main === module) {
    runCli().then((result) => {
        process.stdout.write(`${JSON.stringify(result)}\n`);
        if (result.success !== true) process.exitCode = 1;
    }).catch((error) => {
        // Never log upstream bodies, credentials, tokens or raw causes.
        const safeCodes = new Set(['tg_worker_invalid_arguments', 'tg_worker_configuration_error', 'tg_worker_database_error', 'gramix_configuration_error']);
        const code = safeCodes.has(error?.code) ? error.code : 'tg_worker_failed';
        process.stderr.write(`${JSON.stringify({ success: false, code })}\n`);
        process.exitCode = 1;
    });
}

module.exports = { parseArgs, runCli };
