'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { runCli, parseArgs } = require('../scripts/shop-supplier-worker');
const f = require('./helpers/shop-supplier-runtime-fixture');
const env = { ...f.env, SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-service-key' };
test('worker accepts one bounded batch and rejects unknown or ambiguous limit arguments', () => {
    assert.deepEqual(parseArgs([]), { limit: 5 });
    assert.deepEqual(parseArgs(['--once', '--limit', '20']), { limit: 20 });
    for (const argv of [['--limit'], ['--limit', '0'], ['--limit', '21'], ['--limit', '1.5'],
        ['--limit', '1', '--limit', '2'], ['--watch'], ['--root', '/tmp']]) {
        assert.throws(() => parseArgs(argv), { code: 'supplier_worker_invalid_arguments' });
    }
});
test('worker master and phase switches fail closed before reading secrets or initializing a client', async () => {
    for (const config of [{}, { SHOP_SUPPLIER_RUNTIME_V2_ENABLED: 'TRUE' },
        { SHOP_SUPPLIER_RUNTIME_V2_ENABLED: 'true', SHOP_SUPPLIER_DISPATCH_V2_ENABLED: 'TRUE' }]) {
        const disabledEnv = new Proxy(config, { get(target, key) {
            if (/SUPABASE|KEY|SECRET/.test(String(key))) assert.fail('disabled worker read a secret');
            return target[key];
        } });
        const result = await runCli({ argv: [], env: disabledEnv,
            databaseFactory() { assert.fail('disabled worker initialized a client'); },
            registryFactory() { assert.fail('disabled worker initialized a merchant'); } });
        assert.deepEqual(result, { success: true, disabled: true, processed: 0 });
    }
});
test('enabled worker missing configuration fails before database or merchant access', async () => {
    for (const patch of [{ SUPABASE_URL: '' }, { SUPABASE_SERVICE_ROLE_KEY: '' }]) {
        await assert.rejects(runCli({ argv: [], env: { ...env, ...patch },
            databaseFactory() { assert.fail('must not initialize'); } }), { code: 'supplier_worker_configuration_error' });
    }
});
test('injected worker processes original persisted account with safe aggregate output', async () => {
    const h = f.fixture(); const registries = [];
    const result = await runCli({ argv: ['--once', '--limit', '1'], env,
        databaseFactory(url, key) { assert.equal(url, env.SUPABASE_URL); assert.equal(key, env.SUPABASE_SERVICE_ROLE_KEY); return h.db; },
        registryFactory(config) { registries.push(config); return { require(provider) {
            assert.equal(provider, 'fixture'); return h.adapter;
        } }; } });
    assert.deepEqual(result, { success: true, disabled: false, processed: 1, counts: { ok: 1 } });
    assert.equal(registries.length, 1); assert.deepEqual(registries[0].account, f.accountRow());
    assert.equal(h.calls[0].p_limit, 1); assert.equal(h.http.length, 1);
    assert.doesNotMatch(JSON.stringify(result), /test-service-key|fixture-goods|credential|requestId|token/);
});
test('worker completion uncertainty remains an unsuccessful result without another invocation', async () => {
    const h = f.fixture({ scripts: { finish: () => ({ data: { applied: false } }) } });
    const result = await runCli({ argv: [], env, databaseFactory: () => h.db,
        registryFactory: () => ({ require: () => h.adapter }) });
    assert.equal(result.success, false); assert.equal(result.counts.confirmation_pending, 1);
    assert.equal(h.http.length, 1); assert.equal(h.calls.filter(c => c.p_action === 'scan').length, 1);
});
test('direct default-off CLI emits one aggregate line; invalid arguments exit with only a safe code', () => {
    const script = path.join(__dirname, '../scripts/shop-supplier-worker.js');
    const off = spawnSync(process.execPath, [script, '--once'], { encoding: 'utf8', env: {} });
    assert.equal(off.status, 0); assert.equal(off.stderr, '');
    assert.deepEqual(JSON.parse(off.stdout), { success: true, disabled: true, processed: 0 });
    const invalid = spawnSync(process.execPath, [script, '--secret-value'], { encoding: 'utf8', env: {} });
    assert.equal(invalid.status, 1); assert.equal(invalid.stdout, '');
    assert.deepEqual(JSON.parse(invalid.stderr), { success: false, code: 'supplier_worker_invalid_arguments' });
});

test('spawned worker CLI redacts credentials, lease data, supplier payloads and delivery content', () => {
    const script = path.join(__dirname, '../scripts/shop-supplier-worker.js');
    const preload = path.join(__dirname, 'helpers/shop-supplier-worker-redaction-preload.js');
    const secrets = [
        'LEAK_SERVICE_ROLE_SENTINEL', 'LEAK_SUPPLIER_APP_KEY_SENTINEL',
        'LEAK_DELIVERY_KEY_SENTINEL_012345678901234567890123456789',
        'LEAK_FINGERPRINT_KEY_SENTINEL_012345678901234567890123456789',
        'LEAK_UPSTREAM_PAYLOAD_SENTINEL', 'LEAK_DELIVERY_CONTENT_SENTINEL',
        'LEAK_DATABASE_ERROR_SENTINEL', 'LEAK_ADAPTER_ERROR_SENTINEL',
        f.token, f.attempt, f.request, 'fixture-goods', 'fixture-goods-private-content'
    ];
    const cases = [
        { scenario: 'dispatch', status: 0, output: 'stdout', expected: { success: true, disabled: false, processed: 1, counts: { ok: 1 } } },
        { scenario: 'delivery', status: 0, output: 'stdout', expected: { success: true, disabled: false, processed: 1, counts: { ok: 1 } } },
        { scenario: 'rpc_error', status: 1, output: 'stderr', expected: { success: false, code: 'supplier_runtime_unavailable' } },
        { scenario: 'adapter_error', status: 0, output: 'stdout', expected: { success: true, disabled: false, processed: 1, counts: { unavailable: 1 } } }
    ];
    assert.equal(fs.existsSync(preload), true);
    for (const scenario of cases) {
        const child = spawnSync(process.execPath, [script, '--once', '--limit', '1'], {
            encoding: 'utf8', timeout: 10000,
            env: {
                PATH: process.env.PATH || '',
                HOME: process.env.HOME || '',
                NODE_OPTIONS: `--require=${preload}`,
                SHOP_SUPPLIER_REDACTION_SCENARIO: scenario.scenario,
                SHOP_SUPPLIER_RUNTIME_V2_ENABLED: 'true',
                SHOP_SUPPLIER_DISPATCH_V2_ENABLED: 'true',
                SHOP_SUPPLIER_RECONCILE_V2_ENABLED: 'true',
                SHOP_SUPPLIER_DELIVERY_V2_ENABLED: 'true',
                SHOP_SUPPLIER_DELIVERY_ACTIVE_KEY: 'redaction-test',
                SHOP_SUPPLIER_DELIVERY_KEYS: JSON.stringify({ 'redaction-test': secrets[2] }),
                SHOP_SUPPLIER_DELIVERY_FINGERPRINT_KEY: secrets[3],
                SUPABASE_URL: 'https://fixture.invalid',
                SUPABASE_SERVICE_ROLE_KEY: secrets[0],
                SUPPLIER_FIXTURE_APP_ID: 'LEAK_SUPPLIER_APP_ID_SENTINEL',
                SUPPLIER_FIXTURE_APP_KEY: secrets[1]
            }
        });
        assert.equal(child.error, undefined, `${scenario.scenario}: ${child.error?.message || ''}`);
        assert.equal(child.status, scenario.status, `${scenario.scenario}: ${child.stdout}${child.stderr}`);
        const output = `${child.stdout}${child.stderr}`;
        for (const secret of secrets) assert.equal(output.includes(secret), false, `${scenario.scenario} leaked ${secret}`);
        assert.deepEqual(JSON.parse(child[scenario.output].trim()), scenario.expected);
        assert.equal(child[scenario.output === 'stdout' ? 'stderr' : 'stdout'], '');
    }
});
