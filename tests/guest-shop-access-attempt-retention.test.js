'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const worker = require('../server/guest-shop-worker');

const root = path.resolve(__dirname, '..');

function responseRecorder() {
    return {
        statusCode: 0,
        body: '',
        headers: {},
        setHeader(name, value) { this.headers[name] = value; },
        status(value) { this.statusCode = value; return this; },
        end(value) { this.body = String(value || ''); }
    };
}

function emptyQuery(onRead = () => {}) {
    onRead();
    return {
        select() { return this; },
        eq() { return this; },
        in() { return this; },
        order() { return this; },
        limit() { return this; },
        then(resolve) { resolve({ data: [], error: null }); }
    };
}

function enabledRetentionEnv(overrides = {}) {
    return {
        GUEST_SHOP_BUYER_ACCESS_AUDIT_RETENTION_ENABLED: 'true',
        ...overrides
    };
}

function createPurgeWorker(sequence, options = {}) {
    const calls = [];
    const results = [...sequence];
    const instance = worker.createGuestShopWorker({
        supabase: {
            from() { return emptyQuery(); },
            async rpc(name, params) {
                calls.push({ name, params });
                const next = results.shift();
                if (next instanceof Error) return { data: null, error: next };
                return { data: [next], error: null };
            }
        },
        env: enabledRetentionEnv(options.env),
        now: options.now || (() => new Date('2026-09-20T12:00:00.000Z')),
        logger: options.logger || { error() {} }
    });
    return { instance, calls };
}

test('access-attempt retention has an independent strict switch and defaults off', () => {
    assert.deepEqual(worker.parseAccessAuditRetentionSwitch({}), {
        present: false,
        valid: true,
        enabled: false
    });
    assert.deepEqual(worker.resolveAccessAuditRetention({}), {
        enabled: false,
        valid: true,
        retentionDays: null,
        reason: 'access_audit_retention_disabled'
    });
    assert.equal(worker.resolveAccessAuditRetention({
        GUEST_SHOP_BUYER_CREDENTIAL_ENABLED: 'true'
    }).enabled, false);

    assert.deepEqual(worker.resolveAccessAuditRetention(enabledRetentionEnv({
        GUEST_SHOP_BUYER_CREDENTIAL_ENABLED: 'false'
    })), {
        enabled: true,
        valid: true,
        retentionDays: 30,
        reason: 'enabled'
    });
    assert.equal(worker.resolveAccessAuditRetention(enabledRetentionEnv({
        GUEST_SHOP_BUYER_ACCESS_AUDIT_RETENTION_DAYS: '45'
    })).retentionDays, 45);

    assert.deepEqual(worker.resolveAccessAuditRetention({
        GUEST_SHOP_BUYER_ACCESS_AUDIT_RETENTION_ENABLED: 'sometimes'
    }), {
        enabled: false,
        valid: false,
        retentionDays: null,
        reason: 'access_audit_retention_switch_invalid'
    });
    assert.equal(worker.resolveAccessAuditRetention(enabledRetentionEnv({
        GUEST_SHOP_BUYER_ACCESS_AUDIT_RETENTION_DAYS: '6'
    })).reason, 'access_audit_retention_invalid');
});

test('credentials on with retention off makes the scheduled sweep degraded without calling the database', async () => {
    let databaseCalls = 0;
    const instance = worker.createGuestShopWorker({
        supabase: {
            from() { databaseCalls += 1; throw new Error('must not query'); },
            rpc() { databaseCalls += 1; throw new Error('must not call rpc'); }
        },
        env: {
            GUEST_SHOP_BUYER_CREDENTIAL_ENABLED: 'true',
            GUEST_SHOP_BUYER_ACCESS_AUDIT_RETENTION_ENABLED: 'false'
        }
    });

    const result = await instance.purgeExpiredAccessAttempts();
    assert.equal(result.enabled, false);
    assert.equal(result.deleted_count, 0);
    assert.equal(result.cutoff_at, null);
    assert.equal(result.error, 'access_audit_retention_required');
    assert.equal(result.backlog_degraded, true);
    assert.equal(databaseCalls, 0);
});

test('worker endpoint fails the credential-on retention-off combination closed with HTTP 503', async () => {
    let databaseCalls = 0;
    const handler = worker.createGuestShopWorkerHandler({
        admin: { getOptionalSupabaseAdmin: () => ({}) },
        env: {
            GUEST_SHOP_WORKER_SECRET: 'retention-test-secret',
            GUEST_SHOP_BUYER_CREDENTIAL_ENABLED: 'true',
            GUEST_SHOP_BUYER_ACCESS_AUDIT_RETENTION_ENABLED: 'false'
        },
        logger: { error() {} },
        workerFactory: ({ env }) => worker.createGuestShopWorker({
            supabase: {
                from() { return emptyQuery(() => { databaseCalls += 1; }); },
                async rpc(name) {
                    databaseCalls += 1;
                    if (name === 'fn_guest_shop_release_expired_reservations') {
                        return { data: [{ released_count: 0, unfulfillable_count: 0 }], error: null };
                    }
                    throw new Error(`unexpected RPC: ${name}`);
                }
            },
            env,
            logger: { error() {} }
        })
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = responseRecorder();
        await handler({
            method: 'POST',
            headers: { 'x-guest-shop-worker-secret': 'retention-test-secret' }
        }, response);

        assert.equal(response.statusCode, 503);
        const body = JSON.parse(response.body);
        assert.equal(body.code, 'guest_access_audit_cleanup_failed');
        assert.equal(body.access_audit_cleanup.error, 'access_audit_retention_required');
        assert.equal(body.access_audit_cleanup.backlog_degraded, true);
    }
    assert.equal(databaseCalls, 6, 'ordinary fulfillment reads continue, but no retention RPC may run');
});

test('credentials off with retention on drains bounded batches and uses the configured cutoff', async () => {
    const { instance, calls } = createPurgeWorker([
        { deleted_count: 1000, has_more: true },
        { deleted_count: 1000, has_more: true },
        { deleted_count: 501, has_more: false }
    ], {
        env: {
            GUEST_SHOP_BUYER_CREDENTIAL_ENABLED: 'false',
            GUEST_SHOP_BUYER_ACCESS_AUDIT_RETENTION_DAYS: '30'
        }
    });

    const result = await instance.purgeExpiredAccessAttempts();
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[0], {
        name: 'fn_guest_shop_purge_access_attempts',
        params: {
            p_cutoff: '2026-08-21T12:00:00.000Z',
            p_limit: 1000
        }
    });
    assert.deepEqual(result, {
        enabled: true,
        retention_days: 30,
        cutoff_at: '2026-08-21T12:00:00.000Z',
        batch_size: 1000,
        max_batches: 10,
        batches: 3,
        deleted_count: 2501,
        has_more: false,
        backlog_degraded: false,
        error: null
    });
});

test('ten full batches expose remaining backlog as degraded instead of hiding it', async () => {
    const { instance, calls } = createPurgeWorker(Array.from(
        { length: worker.ACCESS_AUDIT_PURGE_MAX_BATCHES },
        () => ({ deleted_count: 1000, has_more: true })
    ));

    const result = await instance.purgeExpiredAccessAttempts();
    assert.equal(calls.length, 10);
    assert.equal(result.batches, 10);
    assert.equal(result.deleted_count, 10000);
    assert.equal(result.has_more, true);
    assert.equal(result.backlog_degraded, true);
    assert.equal(result.error, null);
});

test('invalid retention configuration makes zero database calls and reports degraded', async () => {
    for (const env of [
        { GUEST_SHOP_BUYER_ACCESS_AUDIT_RETENTION_ENABLED: 'sometimes' },
        enabledRetentionEnv({ GUEST_SHOP_BUYER_ACCESS_AUDIT_RETENTION_DAYS: '181' })
    ]) {
        let databaseCalls = 0;
        const instance = worker.createGuestShopWorker({
            supabase: {
                from() { databaseCalls += 1; throw new Error('must not query'); },
                rpc() { databaseCalls += 1; throw new Error('must not call rpc'); }
            },
            env
        });

        const result = await instance.purgeExpiredAccessAttempts();
        assert.equal(result.deleted_count, 0);
        assert.equal(result.backlog_degraded, true);
        assert.match(result.error, /access_audit_retention/u);
        assert.equal(databaseCalls, 0);
    }
});

test('mid-sweep RPC failure preserves completed work and does not stop order scanning', async () => {
    const rpcCalls = [];
    let orderReads = 0;
    const databaseError = Object.assign(new Error('temporary database failure'), {
        code: 'database_unavailable'
    });
    const instance = worker.createGuestShopWorker({
        supabase: {
            from() { return emptyQuery(() => { orderReads += 1; }); },
            async rpc(name) {
                rpcCalls.push(name);
                if (name === 'fn_guest_shop_release_expired_reservations') {
                    return { data: [{ released_count: 0, unfulfillable_count: 0 }], error: null };
                }
                if (rpcCalls.filter((value) => value === 'fn_guest_shop_purge_access_attempts').length === 1) {
                    return { data: [{ deleted_count: 1000, has_more: true }], error: null };
                }
                return { data: null, error: databaseError };
            }
        },
        env: enabledRetentionEnv(),
        now: () => new Date('2026-09-20T12:00:00.000Z'),
        logger: { error() {} }
    });

    const summary = await instance.runOnce({ limit: 20, runAccessAuditCleanup: true });
    assert.equal(summary.success, true);
    assert.equal(summary.scanned, 0);
    assert.equal(orderReads, 2);
    assert.equal(summary.access_audit_cleanup.batches, 1);
    assert.equal(summary.access_audit_cleanup.deleted_count, 1000);
    assert.equal(summary.access_audit_cleanup.has_more, true);
    assert.equal(summary.access_audit_cleanup.backlog_degraded, true);
    assert.equal(summary.access_audit_cleanup.error, 'database_unavailable');
});

test('invalid RPC result is not counted as a successful deletion', async () => {
    const { instance } = createPurgeWorker([
        { deleted_count: worker.ACCESS_AUDIT_PURGE_BATCH_SIZE + 1, has_more: false }
    ]);
    const result = await instance.purgeExpiredAccessAttempts();
    assert.equal(result.batches, 0);
    assert.equal(result.deleted_count, 0);
    assert.equal(result.error, 'access_audit_purge_result_invalid');
    assert.equal(result.backlog_degraded, true);
});

test('worker endpoint schedules cleanup once per window and keeps ordinary runs healthy', async () => {
    const starts = [
        new Date('2026-09-20T12:00:00.000Z'),
        new Date('2026-09-20T12:01:00.000Z'),
        new Date('2026-09-20T12:10:00.000Z')
    ];
    const runOptions = [];
    const handler = worker.createGuestShopWorkerHandler({
        admin: { getOptionalSupabaseAdmin: () => ({}) },
        env: { GUEST_SHOP_WORKER_SECRET: 'retention-test-secret' },
        now: () => starts.shift(),
        workerFactory: () => ({
            async runOnce(options) {
                runOptions.push(options);
                return {
                    success: true,
                    scanned: 0,
                    access_audit_cleanup: options.runAccessAuditCleanup
                        ? { error: null, backlog_degraded: false }
                        : { skipped: 'not_scheduled', error: null, backlog_degraded: false }
                };
            }
        })
    });

    for (let index = 0; index < 3; index += 1) {
        const response = responseRecorder();
        await handler({
            method: 'POST',
            headers: { 'x-guest-shop-worker-secret': 'retention-test-secret' }
        }, response);
        assert.equal(response.statusCode, 200);
    }

    assert.deepEqual(runOptions.map((options) => options.runAccessAuditCleanup), [true, false, true]);
});

test('worker endpoint returns a systemd-detectable 503 while preserving fulfillment results', async () => {
    const cases = [
        {
            cleanup: {
                batches: 1,
                deleted_count: 1000,
                has_more: true,
                backlog_degraded: true,
                error: 'database_unavailable'
            },
            code: 'guest_access_audit_cleanup_failed'
        },
        {
            cleanup: {
                batches: 10,
                deleted_count: 10000,
                has_more: true,
                backlog_degraded: true,
                error: null
            },
            code: 'guest_access_audit_backlog_degraded'
        }
    ];

    for (const scenario of cases) {
        const handler = worker.createGuestShopWorkerHandler({
            admin: { getOptionalSupabaseAdmin: () => ({}) },
            env: { GUEST_SHOP_WORKER_SECRET: 'retention-test-secret' },
            logger: { error() {} },
            workerFactory: () => ({
                async runOnce() {
                    return {
                        success: true,
                        scanned: 2,
                        processed: 2,
                        delivered: 1,
                        refunded: 1,
                        access_audit_cleanup: scenario.cleanup
                    };
                }
            })
        });
        const response = responseRecorder();
        await handler({
            method: 'POST',
            headers: { 'x-guest-shop-worker-secret': 'retention-test-secret' }
        }, response);

        assert.equal(response.statusCode, 503);
        const body = JSON.parse(response.body);
        assert.equal(body.success, false);
        assert.equal(body.worker_run_success, true);
        assert.equal(body.degraded, true);
        assert.equal(body.code, scenario.code);
        assert.equal(body.scanned, 2);
        assert.equal(body.delivered, 1);
        assert.equal(body.refunded, 1);
        assert.deepEqual(body.access_audit_cleanup, scenario.cleanup);
    }
});

test('retention capacity and catch-up bounds remain explicit', () => {
    const rowsPerSweep = worker.ACCESS_AUDIT_PURGE_BATCH_SIZE
        * worker.ACCESS_AUDIT_PURGE_MAX_BATCHES;
    const sweepsPerHour = (60 * 60 * 1000) / worker.ACCESS_AUDIT_SWEEP_INTERVAL_MS;
    const rowsPerHour = rowsPerSweep * sweepsPerHour;
    const rowsPerDay = rowsPerHour * 24;

    assert.equal(rowsPerSweep, 10000);
    assert.equal(rowsPerHour, 60000);
    assert.equal(rowsPerDay, 1440000);
    assert.ok(Math.abs((1000000 / rowsPerHour) - (50 / 3)) < Number.EPSILON * 10);
    assert.equal(rowsPerDay - 1000000, 440000);
    assert.equal(rowsPerDay - 1439999, 1);
    assert.equal(rowsPerDay - 1440000, 0);
    assert.equal(rowsPerDay - 1440001, -1);
});

test('retention SQL enforces trusted ownership, exact grants, serialized bounded cleanup, and has_more', () => {
    const migration = fs.readFileSync(path.join(
        root,
        'supabase/migrations/20260924_guest_shop_access_attempt_retention.sql'
    ), 'utf8');
    const verify = fs.readFileSync(path.join(
        root,
        'supabase/migrations/20260924_verify_guest_shop_access_attempt_retention.sql'
    ), 'utf8');

    assert.match(migration, /guest_shop_access_attempts_retention_idx[\s\S]*\(created_at ASC, id ASC\)/u);
    assert.match(migration, /RETURNS TABLE \(deleted_count INTEGER, has_more BOOLEAN\)/u);
    assert.match(migration, /LIMIT \(v_limit \+ 1\)[\s\S]*FOR UPDATE SKIP LOCKED/u);
    assert.match(migration, /victims AS \([\s\S]*LIMIT v_limit\s*\)/u);
    assert.match(migration, /COUNT\(\*\) > v_limit FROM candidates/u);
    assert.match(migration, /SECURITY DEFINER[\s\S]*SET search_path = pg_catalog, pg_temp/u);
    assert.match(migration, /PERFORM public\.guest_shop_require_service_role\(\)/u);
    assert.match(migration, /pg_catalog\.pg_advisory_xact_lock/u);
    assert.match(migration, /ALTER FUNCTION[\s\S]*OWNER TO postgres/u);
    assert.match(migration, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated, service_role/u);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION[\s\S]*TO service_role/u);
    assert.doesNotMatch(migration, /pg_cron|cron\.schedule|CREATE TRIGGER/iu);

    assert.match(verify, /owner_name IN \('postgres', 'supabase_admin'\)/u);
    assert.match(verify, /TABLE\(deleted_count integer, has_more boolean\)/u);
    assert.match(verify, /LIMIT \(v_limit \+ 1\)/u);
    assert.match(verify, /def LIKE '%LIMIT v_limit%'/u);
    assert.match(verify, /same_name_overload_count/u);
    assert.match(verify, /indisvalid/u);
    assert.match(verify, /indisready/u);
    assert.match(verify, /indpred IS NULL/u);
    assert.match(verify, /indexprs IS NULL/u);
    assert.match(verify, /indnatts = 2/u);
    assert.match(verify, /indnkeyatts = 2/u);
    assert.match(verify, /is_ascending_nulls_last/u);
    assert.match(verify, /key_columns = ARRAY\['created_at', 'id'\]::NAME\[\]/u);
    assert.match(verify, /has_function_privilege\('anon'/u);
    assert.match(verify, /has_function_privilege\('authenticated'/u);
    assert.match(verify, /has_function_privilege\('service_role'/u);
    assert.match(verify, /grantee NOT IN \(owner_name, 'service_role'\)/u);
    assert.match(verify, /AND NOT is_grantable/u);
});
