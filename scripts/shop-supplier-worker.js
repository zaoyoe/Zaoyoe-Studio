#!/usr/bin/env node
'use strict';

const { createSupplierRuntime } = require('../server/integrations/suppliers/runtime');
const { createConfiguredSupplierAdapterRegistry } = require('../server/integrations/suppliers/registry');
function parseArgs(argv) {
    let limit = 5;
    let seen = false;
    for (let index = 0; index < argv.length; index += 1) {
        if (argv[index] === '--once') continue;
        if (argv[index] === '--limit' && !seen && /^\d{1,2}$/.test(argv[index + 1] || '')) {
            limit = Number(argv[++index]); seen = true;
            if (limit >= 1 && limit <= 20) continue;
        }
        throw Object.assign(new Error('supplier_worker_invalid_arguments'), { code: 'supplier_worker_invalid_arguments' });
    }
    return { limit };
}
async function runCli({ argv = process.argv.slice(2), env = process.env, databaseFactory, registryFactory = createConfiguredSupplierAdapterRegistry } = {}) {
    const options = parseArgs(argv);
    if (env.SHOP_SUPPLIER_RUNTIME_V2_ENABLED !== 'true') return { success: true, disabled: true, processed: 0 };
    if (![env.SHOP_SUPPLIER_DISPATCH_V2_ENABLED, env.SHOP_SUPPLIER_RECONCILE_V2_ENABLED,
        env.SHOP_SUPPLIER_DELIVERY_V2_ENABLED].includes('true')) return { success: true, disabled: true, processed: 0 };
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
        throw Object.assign(new Error('supplier_worker_configuration_error'), { code: 'supplier_worker_configuration_error' });
    }
    const buildDatabase = databaseFactory || ((url, key) => require('@supabase/supabase-js').createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { fetch: (url, options = {}) => fetch(url, { ...options,
            signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000) }) }
    }));
    const db = buildDatabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    return createSupplierRuntime({ db, env,
        resolveAdapter: account => registryFactory({ env, account }).require(account.provider_id)
    }).runOnce(options);
}
if (require.main === module) {
    runCli().then(result => {
        process.stdout.write(`${JSON.stringify(result)}\n`);
        if (!result.success) process.exitCode = 1;
    }).catch(error => {
        const codes = new Set(['supplier_worker_invalid_arguments', 'supplier_worker_configuration_error',
            'supplier_runtime_unavailable', 'supplier_runtime_invalid_candidates', 'supplier_runtime_invalid_claim']);
        process.stderr.write(`${JSON.stringify({ success: false, code: codes.has(error?.code) ? error.code : 'supplier_worker_failed' })}\n`);
        process.exitCode = 1;
    });
}
module.exports = { parseArgs, runCli };
