#!/usr/bin/env node
'use strict';

/**
 * Verify the application-version-matched, supplier-focused local acceptance
 * database. This command is intentionally read-only: it inspects the Docker
 * target and runs catalog/count queries inside the exact container, but never
 * applies migrations or inserts fixture rows.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DOCKER_CONTEXT = 'colima-p2g';
const CONTAINER = 'supabase_db_shop-supplier-p2g-baseline-20261102';
const VOLUME = 'supabase_db_shop-supplier-p2g-baseline-20261102';
const HOST_PORT = '55453';
const EXPECTED_IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.075';
const EXPECTED_POSTGRES_MAJOR = '17';
const EXPECTED_HEAD = '9748be9c8373edd617ec15b7b5c0d52865554f14';
const TARGET_MARKER = CONTAINER;

const MIGRATION_HASHES = Object.freeze({
    '20261102_supplier_p2g_baseline_bootstrap.sql': 'c7d36953628d8bbf778297afd7c589d8f72c8fecaaac30b03197a7c993e838a5',
    '20260523_add_shop_product_skus.sql': '23a7712b48c46da9544e212a675b5f2b7fb7782d3765871587fe6f644af6923a',
    '20260606_add_shop_inventory_procurement_sources.sql': '634734fbbc1043d170c7574ebb9635d2613dd1e71e2bfad794b7f81c0eb258af',
    '20261006_add_shop_supplier_catalog_core.sql': '6e7f9c5749431104289b87d0b61456b48c6bf4e6a740f2df07f44676e0312871',
    '20261019_shop_supplier_platform_v2_readonly.sql': 'bece751537039e700e211a339310771dab77b1ba9f5338c5d3aa05f707080418',
    '20261019_verify_shop_supplier_platform_v2_readonly.sql': '3e239afe41ef758a21e67c57963e9da34b0ad2629b058455df389ce9e0deefb0'
});

const REQUIRED_TABLES = Object.freeze([
    'shop_products',
    'shop_product_skus',
    'shop_inventory',
    'shop_orders',
    'shop_order_items',
    'shop_supplier_accounts',
    'shop_supplier_availability',
    'shop_supplier_product_mappings',
    'admin_audit_logs'
]);

const EMPTY_TABLES = Object.freeze([
    'shop_products',
    'shop_product_skus',
    'shop_inventory',
    'shop_orders',
    'shop_order_items',
    'shop_supplier_product_mappings',
    'shop_supplier_availability',
    'admin_audit_logs',
    'auth.users'
]);

function run(command, args, options = {}) {
    return execFileSync(command, args, {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        ...options
    }).trim();
}

function fail(message) {
    const error = new Error(message);
    error.code = 'supplier_p2g_baseline_verification_failed';
    throw error;
}

function parseJson(label, value) {
    try {
        return JSON.parse(value);
    } catch (error) {
        fail(`${label} did not return JSON: ${error.message}`);
    }
}

function sha256(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function gitStatus() {
    const head = run('git', ['rev-parse', 'HEAD']);
    const originMain = run('git', ['rev-parse', 'origin/main']);
    const aheadBehind = Number(run('git', ['rev-list', '--count', 'HEAD..origin/main']));
    const dirtyFiles = run('git', ['status', '--porcelain'])
        .split('\n')
        .map((line) => line.trimEnd())
        .filter(Boolean);
    return {
        head,
        originMain,
        headMatchesOriginMain: head === originMain,
        behindOriginMain: aheadBehind,
        workingTreeDirty: dirtyFiles.length > 0,
        changedFileCount: dirtyFiles.length,
        expectedHead: EXPECTED_HEAD,
        headMatchesExpected: head === EXPECTED_HEAD
    };
}

function dockerInspect() {
    const inspect = parseJson('docker inspect', run('docker', ['--context', DOCKER_CONTEXT, 'inspect', CONTAINER]));
    if (!Array.isArray(inspect) || inspect.length !== 1) fail(`expected exactly one container named ${CONTAINER}`);
    const container = inspect[0];
    const mounts = Array.isArray(container.Mounts) ? container.Mounts : [];
    const volumeMount = mounts.find((mount) => mount.Type === 'volume' && mount.Destination === '/var/lib/postgresql/data');
    const portBindings = container.HostConfig?.PortBindings?.['5432/tcp'] || [];
    const hostPorts = portBindings.map((binding) => String(binding.HostPort));
    return {
        name: container.Name?.replace(/^\//, ''),
        id: container.Id,
        status: container.State?.Status,
        health: container.State?.Health?.Status || null,
        image: container.Config?.Image,
        volume: volumeMount?.Name || null,
        hostPorts,
        expected: {
            context: DOCKER_CONTEXT,
            container: CONTAINER,
            volume: VOLUME,
            image: EXPECTED_IMAGE,
            hostPort: HOST_PORT
        }
    };
}

function inspectVolume() {
    const inspected = parseJson('docker volume inspect', run('docker', ['--context', DOCKER_CONTEXT, 'volume', 'inspect', VOLUME]));
    if (!Array.isArray(inspected) || inspected.length !== 1) fail(`expected exactly one Docker volume named ${VOLUME}`);
    return {
        name: inspected[0].Name,
        driver: inspected[0].Driver,
        labels: inspected[0].Labels || {}
    };
}

function queryDatabase() {
    const sql = `
BEGIN TRANSACTION READ ONLY;
SELECT jsonb_build_object(
    'database', current_database(),
    'serverVersion', current_setting('server_version'),
    'targetMarker', current_setting('app.supplier_p2g_target', true),
    'tables', (
        SELECT jsonb_object_agg(table_name, true ORDER BY table_name)
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY(ARRAY['${REQUIRED_TABLES.join("','")}'])
    ),
    'rls', (
        SELECT jsonb_object_agg(c.relname, c.relrowsecurity ORDER BY c.relname)
        FROM pg_class AS c
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = ANY(ARRAY['shop_supplier_accounts','shop_supplier_availability','shop_supplier_product_mappings'])
    ),
    'supplierAccounts', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'providerId', provider_id,
            'accountKey', account_key,
            'credentialRef', credential_ref,
            'enabled', is_enabled
        ) ORDER BY provider_id, account_key), '[]'::jsonb)
        FROM public.shop_supplier_accounts
    ),
    'defaultSkuTrigger', EXISTS (
        SELECT 1
        FROM pg_trigger AS t
        JOIN pg_class AS c ON c.oid = t.tgrelid
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'shop_products'
          AND t.tgname = 'tr_shop_products_ensure_default_sku'
          AND NOT t.tgisinternal
    ),
    'importRpc', (
        SELECT jsonb_build_object(
            'exists', true,
            'securityDefiner', p.prosecdef,
            'configuration', p.proconfig,
            'serviceRoleExecute', has_function_privilege('service_role', p.oid, 'EXECUTE'),
            'anonExecute', has_function_privilege('anon', p.oid, 'EXECUTE'),
            'authenticatedExecute', has_function_privilege('authenticated', p.oid, 'EXECUTE')
        )
        FROM pg_proc AS p
        JOIN pg_namespace AS n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'import_shop_supplier_draft_v2'
        ORDER BY p.oid DESC
        LIMIT 1
    ),
    'counts', (
        SELECT jsonb_object_agg(key, value ORDER BY key)
        FROM (
            SELECT 'shop_products' AS key, COUNT(*)::int AS value FROM public.shop_products
            UNION ALL SELECT 'shop_product_skus', COUNT(*)::int FROM public.shop_product_skus
            UNION ALL SELECT 'shop_inventory', COUNT(*)::int FROM public.shop_inventory
            UNION ALL SELECT 'shop_orders', COUNT(*)::int FROM public.shop_orders
            UNION ALL SELECT 'shop_order_items', COUNT(*)::int FROM public.shop_order_items
            UNION ALL SELECT 'shop_supplier_product_mappings', COUNT(*)::int FROM public.shop_supplier_product_mappings
            UNION ALL SELECT 'shop_supplier_availability', COUNT(*)::int FROM public.shop_supplier_availability
            UNION ALL SELECT 'admin_audit_logs', COUNT(*)::int FROM public.admin_audit_logs
            UNION ALL SELECT 'auth.users', COUNT(*)::int FROM auth.users
        ) AS rows
    )
) AS result;
ROLLBACK;
`;
    const output = run('docker', [
        '--context', DOCKER_CONTEXT,
        'exec',
        '-e', `PGOPTIONS=-c app.supplier_p2g_target=${TARGET_MARKER}`,
        CONTAINER,
        'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-c', sql
    ]);
    return parseJson('supplier P2G database query', output);
}

function verify(git, container, volume, db) {
    const failures = [];
    const expect = (condition, message) => { if (!condition) failures.push(message); };

    expect(git.headMatchesOriginMain, 'HEAD is behind or diverged from origin/main');
    expect(git.behindOriginMain === 0, `HEAD..origin/main is ${git.behindOriginMain}, expected 0`);
    expect(git.headMatchesExpected, `HEAD is ${git.head}, expected ${EXPECTED_HEAD}`);
    expect(container.name === CONTAINER, `container is ${container.name}, expected ${CONTAINER}`);
    expect(container.status === 'running', `container status is ${container.status}, expected running`);
    expect(container.health === 'healthy', `container health is ${container.health}, expected healthy`);
    expect(container.image === EXPECTED_IMAGE, `container image is ${container.image}, expected ${EXPECTED_IMAGE}`);
    expect(container.volume === VOLUME, `database volume is ${container.volume}, expected ${VOLUME}`);
    expect(container.hostPorts.includes(HOST_PORT), `container does not expose host port ${HOST_PORT}`);
    expect(volume.name === VOLUME, `inspected volume is ${volume.name}, expected ${VOLUME}`);
    expect(db.database === 'postgres', `database is ${db.database}, expected postgres`);
    expect(String(db.serverVersion).startsWith(`${EXPECTED_POSTGRES_MAJOR}.`), `PostgreSQL is ${db.serverVersion}, expected ${EXPECTED_POSTGRES_MAJOR}.x`);
    expect(db.targetMarker === TARGET_MARKER, `target marker is ${db.targetMarker}, expected ${TARGET_MARKER}`);

    for (const table of REQUIRED_TABLES) expect(db.tables?.[table] === true, `missing required table public.${table}`);
    for (const table of ['shop_supplier_accounts', 'shop_supplier_availability', 'shop_supplier_product_mappings']) {
        expect(db.rls?.[table] === true, `RLS is not enabled on public.${table}`);
    }
    const accounts = Array.isArray(db.supplierAccounts) ? db.supplierAccounts : [];
    const xiareng = accounts.find((account) => account.providerId === 'xiareng' && account.accountKey === 'default');
    const legacy = accounts.find((account) => account.providerId === '16688' && account.accountKey === 'default');
    expect(xiareng?.enabled === false, 'xiareng/default is not disabled');
    expect(legacy?.enabled === false, '16688/default is not disabled');
    expect(db.defaultSkuTrigger === true, 'default SKU trigger is missing');
    expect(db.importRpc?.exists === true, 'import_shop_supplier_draft_v2 is missing');
    expect(db.importRpc?.securityDefiner === true, 'import_shop_supplier_draft_v2 is not SECURITY DEFINER');
    expect(Array.isArray(db.importRpc?.configuration) && db.importRpc.configuration.some((value) => String(value).replace(/\s/g, '') === 'search_path=public,pg_temp'), 'import RPC search_path is not fixed to public, pg_temp');
    expect(db.importRpc?.serviceRoleExecute === true, 'service_role cannot execute import RPC');
    expect(db.importRpc?.anonExecute === false, 'anon can execute import RPC');
    expect(db.importRpc?.authenticatedExecute === false, 'authenticated can execute import RPC');
    for (const table of EMPTY_TABLES) expect(Number(db.counts?.[table]) === 0, `${table} contains ${db.counts?.[table]} rows; expected 0`);

    return failures;
}

function migrationEvidence() {
    return Object.fromEntries(Object.entries(MIGRATION_HASHES).map(([file, expected]) => {
        const filePath = file.endsWith('baseline_bootstrap.sql')
            ? path.join(ROOT, 'supabase', 'acceptance', file)
            : path.join(ROOT, 'supabase', 'migrations', file);
        const actual = fs.existsSync(filePath) ? sha256(filePath) : null;
        return [file, { path: filePath, expected, actual, matches: actual === expected }];
    }));
}

function main() {
    const git = gitStatus();
    const container = dockerInspect();
    const volume = inspectVolume();
    const db = queryDatabase();
    const migrations = migrationEvidence();
    const migrationFailures = Object.entries(migrations)
        .filter(([, evidence]) => !evidence.matches)
        .map(([file, evidence]) => `${file} hash is ${evidence.actual || 'missing'}, expected ${evidence.expected}`);
    const failures = [...verify(git, container, volume, db), ...migrationFailures];
    const report = {
        ok: failures.length === 0,
        generatedAt: new Date().toISOString(),
        git,
        docker: { context: DOCKER_CONTEXT, container, volume },
        database: db,
        migrations,
        failures
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (failures.length > 0) process.exitCode = 1;
}

try {
    main();
} catch (error) {
    process.stderr.write(`supplier-p2g baseline verification failed: ${error.message}\n`);
    process.exitCode = 1;
}

