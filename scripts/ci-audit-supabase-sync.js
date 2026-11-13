#!/usr/bin/env node
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { runDbSecurityAudit } = require('./audit-db-security');

const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_MIGRATIONS_DIR = path.join(ROOT_DIR, 'supabase', 'migrations');

const STRICT_SELF_CONTAINED_THRESHOLD = '20261113';
const SENSITIVE_TABLES = new Set([
    'shop_cdk_secrets',
    'rate_limit_buckets',
    'redemption_codes',
    'redemption_batches',
    'payment_events',
    'payment_orders',
    'admin_audit_logs',
    'admin_roles',
    'admin_secret_store'
]);
const PRIVILEGED_RPC_PREFIXES = [
    'fn_purchase_',
    'fn_deduct_',
    'fn_recharge_',
    'fn_refund_',
    'fn_process_',
    'fn_apply_',
    'fn_confirm_',
    'fn_issue_',
    'fn_admin_',
    'fn_grant_',
    'fn_guest_shop_',
    'fn_resolve_',
    'fn_audit_'
];
const PROTECTED_INTERNAL_RPCS = Object.freeze([
    'fn_deduct_points',
    'fn_deduct_points_admin_site',
    'fn_deduct_points_admin_site_with_breakdown',
    'fn_recharge_points',
    'fn_refund_points',
    'fn_process_afdian_payment',
    'fn_apply_payment_order_review',
    'fn_confirm_payment_order_Paid',
    'fn_issue_discount_for_user',
    'fn_purchase_shop_item',
    'fn_purchase_shop_item_core',
    'fn_purchase_shop_item_with_discounts'
]);

function stripSqlComments(sql) {
    return String(sql || '')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/--[^\n]*/g, ' ');
}

function normalizeIdentifier(raw) {
    return String(raw || '')
        .trim()
        .replace(/^public\./i, '')
        .replace(/"/g, '')
        .toLowerCase();
}

function isStrictSelfContainedMigration(filename) {
    const match = String(filename || '').match(/^(\d{8,14})_/);
    if (!match) {
        return false;
    }
    return match[1].slice(0, 8) >= STRICT_SELF_CONTAINED_THRESHOLD;
}

function extractMigrationVersion(filename) {
    const match = String(filename || '').match(/^(\d{8,14})_/);
    return match ? match[1] : '';
}

function isPrivilegedFunctionName(name, isSecurityDefiner = false) {
    const normalized = normalizeIdentifier(name);
    if (isSecurityDefiner) {
        return true;
    }
    return PRIVILEGED_RPC_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function auditStaticMigrations({ migrationsDir = DEFAULT_MIGRATIONS_DIR } = {}) {
    if (!fs.existsSync(migrationsDir)) {
        throw new Error(`Migrations directory not found: ${migrationsDir}`);
    }

    const files = fs.readdirSync(migrationsDir)
        .filter((name) => name.endsWith('.sql'))
        .sort();

    const violations = [];
    const checkedStrictFiles = [];
    let phase01MarkerSeen = false;
    let unlockPromptRecreatedAfterDrop = false;
    let guardTriggerDropped = false;
    let linkageIndexDropped = false;

    for (const file of files) {
        const fullPath = path.join(migrationsDir, file);
        const rawSql = fs.readFileSync(fullPath, 'utf8');
        const sql = stripSqlComments(rawSql);
        const lowerSql = sql.toLowerCase();

        if (file === '20261113_security_hardening_phase0_phase1.sql') {
            phase01MarkerSeen = true;
        }

        if (phase01MarkerSeen && file !== '20261113_security_hardening_phase0_phase1.sql') {
            if (/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?unlock_prompt\b/i.test(sql)) {
                unlockPromptRecreatedAfterDrop = true;
                violations.push({
                    file,
                    type: 'retired_rpc_recreated',
                    message: 'Legacy RPC unlock_prompt must never be recreated'
                });
            }
            if (/drop\s+trigger\s+(?:if\s+exists\s+)?trg_payment_orders_guard_refund_state\b/i.test(sql)
                && !/create\s+trigger\s+trg_payment_orders_guard_refund_state\b/i.test(sql)) {
                guardTriggerDropped = true;
                violations.push({
                    file,
                    type: 'security_trigger_dropped',
                    message: 'trg_payment_orders_guard_refund_state cannot be dropped without replacement'
                });
            }
            if (/drop\s+index\s+(?:if\s+exists\s+)?(?:public\.)?idx_discount_user_assets_linkage_batch_unique\b/i.test(sql)
                && !/create\s+unique\s+index\b[\s\S]*idx_discount_user_assets_linkage_batch_unique\b/i.test(sql)) {
                linkageIndexDropped = true;
                violations.push({
                    file,
                    type: 'security_index_dropped',
                    message: 'idx_discount_user_assets_linkage_batch_unique cannot be dropped without replacement'
                });
            }
        }

        // Across all migrations dated >= 20261113, check grants to anon on sensitive tables
        const grantMatches = sql.matchAll(/grant\s+[^;]*?\bon\s+(?:table\s+)?(?:public\.)?("?[a-zA-Z0-9_]+"?)\s+to\s+([^;]+);/gi);
        for (const match of grantMatches) {
            const tableName = normalizeIdentifier(match[1]);
            const targetRoles = String(match[2] || '').toLowerCase();
            if (SENSITIVE_TABLES.has(tableName) && /\b(anon|public)\b/.test(targetRoles)) {
                violations.push({
                    file,
                    type: 'sensitive_table_anon_grant',
                    table: tableName,
                    message: `Sensitive table ${tableName} granted privileges to anon/public`
                });
            }
        }

        if (isStrictSelfContainedMigration(file)) {
            checkedStrictFiles.push(file);

            // 1. Every newly created table must enable RLS in the same migration
            const createTableRegex = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?("?[a-zA-Z0-9_]+"?)\s*\(/gi;
            for (const match of sql.matchAll(createTableRegex)) {
                const tableName = normalizeIdentifier(match[1]);
                const rlsPattern = new RegExp(`alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:public\\.)?"?${tableName}"?\\s+enable\\s+row\\s+level\\s+security`, 'i');
                if (!rlsPattern.test(sql)) {
                    violations.push({
                        file,
                        type: 'table_missing_rls',
                        table: tableName,
                        message: `New table ${tableName} in ${file} must enable ROW LEVEL SECURITY`
                    });
                }
            }

            // 2. Every privileged / SECURITY DEFINER function must explicitly revoke PUBLIC execution
            const createFnRegex = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?("?[a-zA-Z0-9_]+"?)\s*\([\s\S]*?(?=(?:create\s+(?:or\s+replace\s+)?function\b|$))/gi;
            for (const match of sql.matchAll(createFnRegex)) {
                const fnName = normalizeIdentifier(match[1]);
                const bodySnippet = String(match[0] || '');
                const isDefiner = /security\s+definer/i.test(bodySnippet);
                if (isPrivilegedFunctionName(fnName, isDefiner)) {
                    const revokePattern = new RegExp(`revoke\\s+all\\s+on\\s+function\\s+(?:public\\.)?"?${fnName}"?\\s*\\([\\s\\S]*?\\)\\s+from\\s+[^;]*\\bpublic\\b`, 'i');
                    if (!revokePattern.test(lowerSql)) {
                        violations.push({
                            file,
                            type: 'rpc_missing_revoke_public',
                            functionName: fnName,
                            message: `Privileged function ${fnName} in ${file} must explicitly REVOKE ALL ... FROM PUBLIC`
                        });
                    }
                }
            }
        }
    }

    if (!phase01MarkerSeen) {
        violations.push({
            file: '20261113_security_hardening_phase0_phase1.sql',
            type: 'missing_required_hardening_migration',
            message: 'Missing 20261113_security_hardening_phase0_phase1.sql'
        });
    }

    return {
        ok: violations.length === 0,
        totalMigrations: files.length,
        strictMigrationsChecked: checkedStrictFiles.length,
        invariants: {
            phase01MarkerSeen,
            unlockPromptRecreatedAfterDrop,
            guardTriggerDropped,
            linkageIndexDropped
        },
        violations
    };
}

async function auditLiveSupabase({
    env = process.env,
    adminSupabase = null,
    anonSupabase = null,
    migrationsDir = DEFAULT_MIGRATIONS_DIR,
    queryAppliedVersions = null
} = {}) {
    const dbAudit = await runDbSecurityAudit({ env, adminSupabase, anonSupabase });
    const violations = [...(dbAudit.violations || [])];

    let admin = adminSupabase;
    if (!admin && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
        const { createClient } = require('@supabase/supabase-js');
        admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
        });
    }

    let unprotectedTables = [];
    if (typeof admin?.rpc === 'function') {
        const unprotectedRes = await admin.rpc('fn_audit_unprotected_tables');
        if (unprotectedRes?.error) {
            violations.push({
                type: 'unprotected_tables_rpc_error',
                message: `fn_audit_unprotected_tables failed: ${unprotectedRes.error.message || 'unknown'}`
            });
        } else if (Array.isArray(unprotectedRes?.data) && unprotectedRes.data.length > 0) {
            unprotectedTables = unprotectedRes.data;
            for (const row of unprotectedRes.data) {
                violations.push({
                    type: 'table_rls_disabled',
                    table: row.table_name,
                    message: `Live public table ${row.table_name} has RLS disabled`
                });
            }
        }
    }

    // Optional migration version sync verification when direct Postgres DB URL is supplied
    const dbUrl = String(env.SUPABASE_DB_URL || env.DATABASE_URL || '').trim();
    let migrationSync = { checked: false, missingVersions: [] };
    if (dbUrl || typeof queryAppliedVersions === 'function') {
        const appliedSet = typeof queryAppliedVersions === 'function'
            ? new Set(await queryAppliedVersions())
            : (() => {
                const raw = execFileSync(
                    'psql',
                    [dbUrl, '-At', '-c', 'SELECT version FROM supabase_migrations.schema_migrations;'],
                    { encoding: 'utf8', timeout: 15000 }
                );
                return new Set(String(raw || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
            })();

        const strictVersions = fs.readdirSync(migrationsDir)
            .filter((file) => file.endsWith('.sql') && isStrictSelfContainedMigration(file))
            .map((file) => ({ file, version: extractMigrationVersion(file) }))
            .filter((entry) => entry.version);

        const missingVersions = strictVersions
            .filter((entry) => !appliedSet.has(entry.version))
            .map((entry) => entry.file);

        migrationSync = { checked: true, missingVersions };
        for (const missingFile of missingVersions) {
            violations.push({
                type: 'migration_not_applied_in_production',
                file: missingFile,
                message: `Local migration ${missingFile} is not recorded in supabase_migrations.schema_migrations`
            });
        }
    }

    const ok = dbAudit.passed && violations.length === 0;
    return {
        ok,
        status: ok ? 'PASS' : 'FAIL',
        dbAudit,
        unprotectedTables,
        migrationSync,
        violations
    };
}

function parseCliArgs(argv = []) {
    return {
        live: argv.includes('--live'),
        json: argv.includes('--json'),
        requireLive: argv.includes('--require-live')
    };
}

async function main() {
    const args = parseCliArgs(process.argv.slice(2));
    const staticResult = auditStaticMigrations();
    const output = {
        static: staticResult,
        live: null,
        passed: staticResult.ok
    };

    if (args.live) {
        const hasCreds = Boolean(
            (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)
            && process.env.SUPABASE_SERVICE_ROLE_KEY
        );
        if (!hasCreds) {
            if (args.requireLive) {
                output.passed = false;
                output.live = { ok: false, skipped: false, error: 'Missing Supabase credentials for --live audit' };
            } else {
                output.live = { ok: true, skipped: true, reason: 'Supabase credentials not configured in environment' };
            }
        } else {
            const liveResult = await auditLiveSupabase({ env: process.env });
            output.live = liveResult;
            output.passed = output.passed && liveResult.ok;
        }
    }

    if (args.json) {
        console.log(JSON.stringify(output, null, 2));
    } else {
        console.log(`Static migrations audited: ${staticResult.totalMigrations} (strict >= ${STRICT_SELF_CONTAINED_THRESHOLD}: ${staticResult.strictMigrationsChecked}) -> ${staticResult.ok ? 'PASS' : 'FAIL'}`);
        if (output.live) {
            console.log(`Live Supabase audit: ${output.live.skipped ? 'SKIPPED' : (output.live.ok ? 'PASS' : 'FAIL')}`);
        }
        const allViolations = [
            ...(staticResult.violations || []),
            ...(output.live?.violations || [])
        ];
        for (const v of allViolations) {
            console.error(`- [${v.type}] ${v.file || v.table || v.functionName || ''}: ${v.message}`);
        }
    }

    if (!output.passed) {
        process.exitCode = 1;
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error?.message || error);
        process.exitCode = 1;
    });
}

module.exports = {
    PROTECTED_INTERNAL_RPCS,
    STRICT_SELF_CONTAINED_THRESHOLD,
    auditLiveSupabase,
    auditStaticMigrations,
    extractMigrationVersion,
    isStrictSelfContainedMigration,
    parseCliArgs,
    stripSqlComments
};
