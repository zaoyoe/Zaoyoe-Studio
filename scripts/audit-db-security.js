#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const SENSITIVE_TABLES = Object.freeze([
    'shop_cdk_secrets',
    'rate_limit_buckets',
    'redemption_codes',
    'redemption_batches'
]);

function readEnvFiles() {
    const rootDir = path.resolve(__dirname, '..');
    const sources = [
        path.join(rootDir, '.env.local'),
        path.join(rootDir, 'server/.env'),
        path.join(rootDir, '.env')
    ];

    const merged = {};
    for (const filePath of sources) {
        if (fs.existsSync(filePath)) {
            const parsed = dotenv.parse(fs.readFileSync(filePath, 'utf8'));
            Object.assign(merged, parsed);
        }
    }
    return Object.assign(merged, process.env);
}

function parseCliArgs(argv = []) {
    return {
        json: argv.includes('--json'),
        failFast: argv.includes('--fail-fast')
    };
}

const PURCHASE_FUNCTIONS = Object.freeze([
    'fn_purchase_shop_item', 'fn_purchase_shop_item_core', 'fn_purchase_shop_item_with_discounts'
]);

async function boundedQuery(query, timeoutMs) {
    let timer;
    try {
        return await Promise.race([
            Promise.resolve().then(query),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('audit_timeout')), timeoutMs); })
        ]);
    } finally { clearTimeout(timer); }
}

async function runDbSecurityAudit({
    env = process.env, adminSupabase = null, anonSupabase = null, clientFactory = null,
    timeoutMs = 10000
} = {}) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new Error('Invalid audit timeout');
    const report = {
        timestamp: new Date().toISOString(), passed: false, status: 'INCOMPLETE',
        summary: { totalTablesAudited: 0, rlsDisabledCount: 0, sensitiveExposedCount: 0, penetrationFailures: 0 },
        violations: [], tables: [], purchaseFunctions: []
    };
    let failed = false;
    let incomplete = false;
    const issue = (type, message, table, confirmed = false) => {
        if (confirmed) failed = true; else incomplete = true;
        report.violations.push({ type, message, ...(table ? { table } : {}) });
    };
    const buildClient = clientFactory || ((url, key) => {
        const { createClient } = require('@supabase/supabase-js');
        return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    });
    const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
    let admin = adminSupabase;
    let anon = anonSupabase;
    try {
        if (!admin && url && env.SUPABASE_SERVICE_ROLE_KEY) admin = buildClient(url, env.SUPABASE_SERVICE_ROLE_KEY);
        const key = env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (!anon && url && key) anon = buildClient(url, key);
    } catch (_) { issue('client_initialization_failed', 'Audit client initialization failed'); }

    if (typeof admin?.rpc !== 'function') {
        issue('admin_client_unavailable', 'Schema and purchase privilege audit unavailable');
    } else {
        try {
            const result = await boundedQuery(() => admin.rpc('fn_audit_db_security'), timeoutMs);
            if (result?.error || !Array.isArray(result?.data) || result.data.length === 0) {
                issue('rpc_audit_error', 'Database catalog audit failed or returned no evidence');
            } else {
                const seen = new Set();
                report.summary.totalTablesAudited = result.data.length;
                for (const row of result.data) {
                    if (!row || typeof row.table_name !== 'string' || !row.table_name || seen.has(row.table_name)
                        || ['rls_enabled', 'rls_forced', 'has_anon_access'].some(key => typeof row[key] !== 'boolean')
                        || !['OK', 'RLS_DISABLED_CRITICAL', 'SENSITIVE_ANON_EXPOSED', 'SENSITIVE_AUTH_EXPOSED'].includes(row.status)) {
                        issue('invalid_catalog_evidence', 'Invalid, duplicate or unknown catalog result');
                        continue;
                    }
                    seen.add(row.table_name);
                    report.tables.push(row);
                    if (!row.rls_enabled || row.status === 'RLS_DISABLED_CRITICAL') {
                        report.summary.rlsDisabledCount++;
                        issue('rls_disabled', 'Row level security is disabled; grants and policies require review', row.table_name, true);
                    }
                    if ((SENSITIVE_TABLES.includes(row.table_name) && row.has_anon_access) || row.status === 'SENSITIVE_ANON_EXPOSED'
                        || row.status === 'SENSITIVE_AUTH_EXPOSED') {
                        report.summary.sensitiveExposedCount++;
                        issue('sensitive_table_exposed', 'Sensitive table has a prohibited client grant', row.table_name, true);
                    }
                }
                for (const table of SENSITIVE_TABLES) {
                    if (!seen.has(table)) issue('missing_sensitive_table', 'Sensitive table was not audited', table);
                }
            }
        } catch (_) { issue('rpc_audit_exception', 'Database catalog audit could not complete'); }
        try {
            const result = await boundedQuery(() => admin.rpc('fn_audit_purchase_rpc_security'), timeoutMs);
            if (result?.error || !Array.isArray(result?.data) || result.data.length === 0) {
                issue('purchase_audit_unavailable', 'Purchase RPC privilege audit unavailable');
            } else {
                const seen = new Set();
                const signatures = new Set();
                for (const row of result.data) {
                    if (!row || !PURCHASE_FUNCTIONS.includes(row.function_name)
                        || typeof row.signature !== 'string' || !row.signature.includes(`${row.function_name}(`)
                        || signatures.has(row.signature)
                        || ['anon_execute', 'authenticated_execute', 'service_execute'].some(key => typeof row[key] !== 'boolean')) {
                        issue('invalid_purchase_evidence', 'Invalid purchase RPC privilege evidence');
                        continue;
                    }
                    signatures.add(row.signature);
                    seen.add(row.function_name);
                    report.purchaseFunctions.push(row);
                    if (row.anon_execute || row.authenticated_execute || !row.service_execute) {
                        issue('purchase_rpc_privilege_violation', 'Purchase RPC is not restricted to the trusted server role', row.signature, true);
                    }
                }
                for (const name of PURCHASE_FUNCTIONS) {
                    if (!seen.has(name)) issue('missing_purchase_function', 'Required purchase function was not audited', name);
                }
            }
        } catch (_) { issue('purchase_audit_exception', 'Purchase RPC privilege audit could not complete'); }
    }
    if (typeof anon?.from !== 'function') {
        issue('anon_client_unavailable', 'Anonymous access probes unavailable');
    } else {
        for (const table of SENSITIVE_TABLES) {
            try {
                const result = await boundedQuery(() => anon.from(table).select('*').limit(1), timeoutMs);
                if (result?.error) {
                    // Network, authentication, missing relation and gateway errors are not access-denial evidence.
                    if (result.error.code !== '42501') issue('anon_probe_error', 'Anonymous probe failed without a verified permission denial', table);
                } else if (!Array.isArray(result?.data)) {
                    issue('invalid_anon_evidence', 'Anonymous probe returned malformed evidence', table);
                } else if (result.data.length) {
                    report.summary.penetrationFailures++;
                    issue('penetration_leak', 'Anonymous client could read records', table, true);
                }
                // An empty response alone proves nothing; PASS also requires the catalog and RPC checks above.
            } catch (_) { issue('anon_probe_exception', 'Anonymous probe could not complete', table); }
        }
    }
    report.status = failed ? 'FAIL' : incomplete ? 'INCOMPLETE' : 'PASS';
    report.passed = report.status === 'PASS';
    return report;
}

async function main() {
    const env = readEnvFiles();
    const args = parseCliArgs(process.argv.slice(2));

    try {
        const report = await runDbSecurityAudit({ env });

        if (args.json) {
            console.log(JSON.stringify(report, null, 2));
        } else {
            console.log('=== Database Security & RLS Audit Report ===');
            console.log(`Timestamp: ${report.timestamp}`);
            console.log(`Total Tables Audited: ${report.summary.totalTablesAudited}`);
            console.log(`RLS Disabled Count: ${report.summary.rlsDisabledCount}`);
            console.log(`Sensitive Tables Exposed: ${report.summary.sensitiveExposedCount}`);
            console.log(`Penetration Failures: ${report.summary.penetrationFailures}`);
            console.log(`Overall Status: ${report.status}`);

            if (report.violations.length > 0) {
                console.log('\n--- Violations ---');
                for (const v of report.violations) {
                    console.error(`- [${v.type}] ${v.table ? `${v.table}: ` : ''}${v.message}`);
                }
            }
        }

        if (!report.passed) {
            process.exitCode = report.status === 'FAIL' ? 1 : 2;
        }
    } catch (err) {
        console.error('Database security audit execution could not complete');
        process.exitCode = 2;
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    runDbSecurityAudit,
    parseCliArgs,
    SENSITIVE_TABLES,
    PURCHASE_FUNCTIONS
};
