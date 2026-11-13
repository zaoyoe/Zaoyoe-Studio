'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const backupR2 = require('../scripts/backup-offsite-r2');
const ciAudit = require('../scripts/ci-audit-supabase-sync');

const REPO_ROOT = path.resolve(__dirname, '..');

test('Phase 3 full-stack offsite backup & sandbox decryption restore drill verifies Supabase + NewAPI Postgres + KC MySQL + 3 service configs', async (t) => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phase3-backup-drill-'));
    t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

    const configDir = path.join(tmpRoot, 'mock-opt');
    fs.mkdirSync(configDir, { recursive: true });

    const verifyEnvPath = path.join(configDir, 'verify.env');
    const newapiEnvPath = path.join(configDir, 'newapi.env');
    const kcEnvPath = path.join(configDir, 'kc.env');
    const verifyComposePath = path.join(configDir, 'verify.compose.yml');

    const verifyEnvSecret = 'VERIFY_SUPER_SECRET=v-secret-xyz-123';
    const newapiEnvSecret = 'POSTGRES_USER=sub2api\nPOSTGRES_PASSWORD=pg-secret-456\nNEWAPI_DB_NAME=newapi';
    const kcEnvSecret = 'DB_USER=root\nDB_PASSWORD=kc-secret-789\nDB_NAME=plus_papay';

    fs.writeFileSync(verifyEnvPath, `${verifyEnvSecret}\n`);
    fs.writeFileSync(newapiEnvPath, `${newapiEnvSecret}\n`);
    fs.writeFileSync(kcEnvPath, `${kcEnvSecret}\n`);
    fs.writeFileSync(verifyComposePath, 'services:\n  verify-server:\n    ports: ["127.0.0.1:3001:3001"]\n');

    const expectedPgDumpBytes = Buffer.from('PGDMP-synthetic-newapi-custom-dump-0123456789abcdef', 'utf8');
    const expectedKcSqlText = '-- MySQL dump\nINSERT INTO orders VALUES (1, "paid");\n';
    const expectedKcSqlBytes = Buffer.from(expectedKcSqlText, 'utf8');

    const runCommand = async (cmd, args) => {
        if (cmd === 'docker' && args[0] === 'ps') {
            return { stdout: 'sub2api-postgres\nkc-gpt-pay2-mysql\nzaoyoe-verify-server\n' };
        }
        if (cmd === 'docker' && args[0] === 'exec' && args.includes('pg_dump')) {
            assert.equal(args.includes('PGPASSWORD=pg-secret-456'), true);
            assert.equal(args.includes('sub2api-postgres'), true);
            assert.equal(args.includes('newapi'), true);
            return { stdout: expectedPgDumpBytes };
        }
        if (cmd === 'docker' && args[0] === 'exec' && args.includes('mysqldump')) {
            assert.equal(args.includes('MYSQL_PWD=kc-secret-789'), true);
            assert.equal(args.includes('kc-gpt-pay2-mysql'), true);
            assert.equal(args.includes('plus_papay'), true);
            return { stdout: expectedKcSqlBytes };
        }
        throw new Error(`Unexpected command in test: ${cmd} ${args.join(' ')}`);
    };

    const supabaseClient = {
        from(table) {
            return {
                select() {
                    return {
                        async range(from) {
                            if (from > 0) return { data: [], error: null };
                            if (table === 'payment_orders') {
                                return { data: [{ id: 'ord_1', status: 'paid', paid_points: 100 }], error: null };
                            }
                            return { data: [{ id: `${table}_row_1` }], error: null };
                        }
                    };
                }
            };
        }
    };

    let uploadedEnvelope = '';
    let capturedHeaders = null;
    const encryptionKey = crypto.randomBytes(32).toString('hex');

    const result = await backupR2.runOffsiteBackup({
        env: {
            OFFSITE_BACKUP_ENCRYPTION_KEY: encryptionKey,
            OFFSITE_BACKUP_KEY_ID: 'drill-k1',
            OFFSITE_BACKUP_R2_ENDPOINT: 'https://r2-account.example.r2.cloudflarestorage.com',
            OFFSITE_BACKUP_R2_BUCKET: 'zaoyoe-disaster-backups',
            OFFSITE_BACKUP_R2_ACCESS_KEY_ID: 'r2-access-key',
            OFFSITE_BACKUP_R2_SECRET_ACCESS_KEY: 'r2-secret-key',
            OFFSITE_BACKUP_INCLUDE_STACK: '1'
        },
        supabaseClient,
        runCommand,
        newapiEnvPath,
        kcEnvPath,
        serviceConfigSpecs: [
            { id: 'verify_env', service: 'verify', filename: 'verify.env', filePath: verifyEnvPath },
            { id: 'verify_compose', service: 'verify', filename: 'verify.docker-compose.yml', filePath: verifyComposePath },
            { id: 'newapi_env', service: 'newapi', filename: 'newapi.env', filePath: newapiEnvPath },
            { id: 'kc_env', service: 'kc', filename: 'kc.env', filePath: kcEnvPath }
        ],
        requireServiceConfigs: true,
        fetchImpl: async (url, init) => {
            assert.match(String(url), /^https:\/\/r2-account\.example\.r2\.cloudflarestorage\.com\/zaoyoe-disaster-backups\/snapshots\//);
            capturedHeaders = init.headers;
            uploadedEnvelope = init.body.toString('utf8');
            return new Response('', { status: 200 });
        }
    });

    assert.equal(result.ok, true);
    assert.equal(result.includeStack, true);
    assert.equal(result.artifactSummary.newapi_postgres_bytes, expectedPgDumpBytes.length);
    assert.equal(result.artifactSummary.kc_mysql_sql_bytes, expectedKcSqlBytes.length);
    assert.equal(result.artifactSummary.service_config_count, 4);
    assert.match(String(capturedHeaders.Authorization || ''), /^AWS4-HMAC-SHA256 /);
    assert.equal(uploadedEnvelope.startsWith('zaoyoe-r2-backup:v1:drill-k1:'), true);
    // Ciphertext must never expose plaintext secrets
    assert.equal(uploadedEnvelope.includes('pg-secret-456'), false);
    assert.equal(uploadedEnvelope.includes('kc-secret-789'), false);
    assert.equal(uploadedEnvelope.includes('v-secret-xyz-123'), false);

    // Wrong key or tampered ciphertext fails closed
    assert.throws(() => backupR2.openBackupPayload(uploadedEnvelope, crypto.randomBytes(32).toString('hex')));
    assert.throws(() => backupR2.openBackupPayload(`${uploadedEnvelope.slice(0, -4)}AAAA`, encryptionKey));

    // Full sandbox extraction & checksum verification drill
    const sandboxDir = path.join(tmpRoot, 'sandbox-restore');
    const drillReport = backupR2.extractBackupArchiveToSandbox(uploadedEnvelope, encryptionKey, sandboxDir);

    assert.equal(drillReport.ok, true);
    assert.equal(drillReport.version, 2);
    assert.equal(drillReport.tableCounts.payment_orders, 1);
    assert.deepEqual(
        fs.readFileSync(drillReport.artifacts.newapi_postgres.path),
        expectedPgDumpBytes
    );
    assert.equal(
        fs.readFileSync(drillReport.artifacts.kc_mysql.path, 'utf8'),
        expectedKcSqlText
    );
    const restoredVerifyEnv = fs.readFileSync(path.join(sandboxDir, 'configs', 'verify.env'), 'utf8');
    assert.match(restoredVerifyEnv, /VERIFY_SUPER_SECRET=v-secret-xyz-123/);
    const restoredKcEnv = fs.readFileSync(path.join(sandboxDir, 'configs', 'kc.env'), 'utf8');
    assert.match(restoredKcEnv, /DB_PASSWORD=kc-secret-789/);

    // Verify S3 signed GET request helper works cleanly
    const getReq = backupR2.buildS3SignedGetRequest({
        endpoint: 'https://r2-account.example.r2.cloudflarestorage.com',
        bucket: 'zaoyoe-disaster-backups',
        objectKey: result.objectKey,
        accessKeyId: 'r2-access-key',
        secretAccessKey: 'r2-secret-key'
    });
    assert.equal(getReq.method, 'GET');
    assert.match(getReq.headers.Authorization, /^AWS4-HMAC-SHA256 /);
});

test('Phase 3 KVM4 backup systemd unit, firewall IPv6 DOCKER-USER + persistence, and SSH hardening scripts', () => {
    const unitText = fs.readFileSync(path.join(REPO_ROOT, 'deploy/kvm4/offsite-backup/zaoyoe-offsite-backup.service'), 'utf8');
    assert.match(unitText, /WorkingDirectory=\/opt\/zaoyoe-verify-server\/app/);
    assert.match(unitText, /ExecStart=\/usr\/bin\/node \/opt\/zaoyoe-verify-server\/app\/scripts\/backup-offsite-r2\.js --include-stack/);
    assert.equal(unitText.includes('/opt/zaoyoe-verify-server/current'), false);

    const backupInstaller = spawnSync('/bin/bash', [
        path.join(REPO_ROOT, 'scripts/install-kvm4-offsite-backup.sh'),
        '--expected-commit', 'a'.repeat(40),
        '--dry-run'
    ], { encoding: 'utf8' });
    assert.equal(backupInstaller.status, 0, backupInstaller.stderr);

    const fwScriptText = fs.readFileSync(path.join(REPO_ROOT, 'scripts/install-kvm4-cloudflare-firewall.sh'), 'utf8');
    assert.match(fwScriptText, /ip6tables -L DOCKER-USER/);
    assert.match(fwScriptText, /ip6tables -I DOCKER-USER 1 -p tcp -m multiport --dports 80,443 -j "\$chain"/);
    assert.match(fwScriptText, /zaoyoe-cloudflare-firewall\.service/);
    assert.match(fwScriptText, /netfilter-persistent save/);

    const fwDryRun = spawnSync('/bin/bash', [
        path.join(REPO_ROOT, 'scripts/install-kvm4-cloudflare-firewall.sh'),
        '--dry-run'
    ], { encoding: 'utf8' });
    assert.equal(fwDryRun.status, 0, fwDryRun.stderr);

    const sshReject22 = spawnSync('/bin/bash', [
        path.join(REPO_ROOT, 'scripts/harden-kvm4-ssh.sh'),
        '--port', '22',
        '--dry-run'
    ], { encoding: 'utf8', env: { ...process.env, KVM4_SKIP_SSH_PROBE: '1' } });
    assert.notEqual(sshReject22.status, 0);

    const sshDryRun = spawnSync('/bin/bash', [
        path.join(REPO_ROOT, 'scripts/harden-kvm4-ssh.sh'),
        '--port', '2222',
        '--dry-run'
    ], { encoding: 'utf8', env: { ...process.env, KVM4_SKIP_SSH_PROBE: '1' } });
    assert.equal(sshDryRun.status, 0, sshDryRun.stderr);
});

test('Phase 3 CI migration gate passes repo migrations and blocks unsafe new tables, unrevoked RPCs, or resurrected unlock_prompt', (t) => {
    const repoResult = ciAudit.auditStaticMigrations();
    assert.equal(repoResult.ok, true, JSON.stringify(repoResult.violations));
    assert.equal(repoResult.invariants.phase01MarkerSeen, true);

    const tmpMigrations = fs.mkdtempSync(path.join(os.tmpdir(), 'phase3-mig-gate-'));
    t.after(() => fs.rmSync(tmpMigrations, { recursive: true, force: true }));

    fs.copyFileSync(
        path.join(REPO_ROOT, 'supabase/migrations/20261113_security_hardening_phase0_phase1.sql'),
        path.join(tmpMigrations, '20261113_security_hardening_phase0_phase1.sql')
    );

    // 1. Table created without RLS
    fs.writeFileSync(
        path.join(tmpMigrations, '20261114_unprotected_table.sql'),
        'CREATE TABLE public.ci_test_secrets (id uuid primary key);\n'
    );
    const badTableRes = ciAudit.auditStaticMigrations({ migrationsDir: tmpMigrations });
    assert.equal(badTableRes.ok, false);
    assert.equal(badTableRes.violations.some((v) => v.type === 'table_missing_rls' && v.table === 'ci_test_secrets'), true);

    // Fix table RLS, now add unrevoked SECURITY DEFINER function
    fs.writeFileSync(
        path.join(tmpMigrations, '20261114_unprotected_table.sql'),
        [
            'CREATE TABLE public.ci_test_secrets (id uuid primary key);',
            'ALTER TABLE public.ci_test_secrets ENABLE ROW LEVEL SECURITY;',
            'CREATE OR REPLACE FUNCTION public.fn_admin_danger(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN END; $$;'
        ].join('\n')
    );
    const badRpcRes = ciAudit.auditStaticMigrations({ migrationsDir: tmpMigrations });
    assert.equal(badRpcRes.ok, false);
    assert.equal(badRpcRes.violations.some((v) => v.type === 'rpc_missing_revoke_public' && v.functionName === 'fn_admin_danger'), true);

    // Add REVOKE ALL ... FROM PUBLIC + resurrect unlock_prompt
    fs.writeFileSync(
        path.join(tmpMigrations, '20261114_unprotected_table.sql'),
        [
            'CREATE TABLE public.ci_test_secrets (id uuid primary key);',
            'ALTER TABLE public.ci_test_secrets ENABLE ROW LEVEL SECURITY;',
            'CREATE OR REPLACE FUNCTION public.fn_admin_danger(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN END; $$;',
            'REVOKE ALL ON FUNCTION public.fn_admin_danger(uuid) FROM PUBLIC, anon, authenticated;',
            'CREATE OR REPLACE FUNCTION public.unlock_prompt() RETURNS void LANGUAGE sql AS $$ SELECT 1; $$;'
        ].join('\n')
    );
    const reviveRes = ciAudit.auditStaticMigrations({ migrationsDir: tmpMigrations });
    assert.equal(reviveRes.ok, false);
    assert.equal(reviveRes.violations.some((v) => v.type === 'retired_rpc_recreated'), true);
});

test('Phase 3 live Supabase sync & audit checks fn_audit_unprotected_tables and migration versions and workflows are wired', async () => {
    const { PURCHASE_FUNCTIONS, SENSITIVE_TABLES } = require('../scripts/audit-db-security');

    const healthyTables = SENSITIVE_TABLES.map((name) => ({
        table_name: name,
        rls_enabled: true,
        rls_forced: true,
        has_anon_access: false,
        status: 'OK'
    }));
    const healthyPurchase = PURCHASE_FUNCTIONS.map((name) => ({
        function_name: name,
        signature: `${name}()`,
        anon_execute: false,
        authenticated_execute: false,
        service_execute: true
    }));

    const adminSupabaseMissingRls = {
        async rpc(name) {
            if (name === 'fn_audit_db_security') return { data: healthyTables, error: null };
            if (name === 'fn_audit_purchase_rpc_security') return { data: healthyPurchase, error: null };
            if (name === 'fn_audit_unprotected_tables') {
                return { data: [{ schema_name: 'public', table_name: 'leaky_new_table', is_rls_enabled: false }], error: null };
            }
            return { data: null, error: null };
        }
    };
    const anonSupabaseOk = {
        from() {
            return {
                select() {
                    return {
                        async limit() {
                            return { data: null, error: { code: '42501', message: 'permission denied' } };
                        }
                    };
                }
            };
        }
    };

    const failUnprotected = await ciAudit.auditLiveSupabase({
        adminSupabase: adminSupabaseMissingRls,
        anonSupabase: anonSupabaseOk,
        queryAppliedVersions: async () => ['20261113']
    });
    assert.equal(failUnprotected.ok, false);
    assert.equal(failUnprotected.violations.some((v) => v.type === 'table_rls_disabled' && v.table === 'leaky_new_table'), true);

    const adminSupabaseClean = {
        async rpc(name) {
            if (name === 'fn_audit_db_security') return { data: healthyTables, error: null };
            if (name === 'fn_audit_purchase_rpc_security') return { data: healthyPurchase, error: null };
            if (name === 'fn_audit_unprotected_tables') return { data: [], error: null };
            return { data: null, error: null };
        }
    };

    const failUnsynced = await ciAudit.auditLiveSupabase({
        adminSupabase: adminSupabaseClean,
        anonSupabase: anonSupabaseOk,
        queryAppliedVersions: async () => [] // missing 20261113
    });
    assert.equal(failUnsynced.ok, false);
    assert.equal(failUnsynced.violations.some((v) => v.type === 'migration_not_applied_in_production'), true);

    const passAll = await ciAudit.auditLiveSupabase({
        adminSupabase: adminSupabaseClean,
        anonSupabase: anonSupabaseOk,
        queryAppliedVersions: async () => ['20261113']
    });
    assert.equal(passAll.ok, true);

    // Check workflow wiring
    const securityWorkflow = fs.readFileSync(path.join(REPO_ROOT, '.github/workflows/security-tests.yml'), 'utf8');
    assert.match(securityWorkflow, /npm run audit:migrations/);
    assert.match(securityWorkflow, /supabase\/migrations\/\*\*/);
    assert.match(securityWorkflow, /vitest run test\/gpt-outsourcing-store\.test\.js/);

    const supabaseAuditWorkflow = fs.readFileSync(path.join(REPO_ROOT, '.github/workflows/supabase-security-audit.yml'), 'utf8');
    assert.match(supabaseAuditWorkflow, /ci-audit-supabase-sync\.js --live/);
});
