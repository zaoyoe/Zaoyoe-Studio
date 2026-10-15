'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs, runCli } = require('../scripts/tg-fulfillment-worker');

test('CLI defaults to one disabled run without database or provider configuration', async () => {
    let calls = 0;
    const result = await runCli({ env: {}, argv: [], databaseFactory() { calls += 1; }, clientFactory() { calls += 1; } });
    assert.deepEqual(result, { success: true, processed: false, disabled: true });
    assert.equal(calls, 0);
});

test('CLI accepts a single optional UUID and rejects unknown or ambiguous arguments', () => {
    const orderId = '18CA3CCE-8441-4DE6-874A-FD34792AE1B5';
    assert.deepEqual(parseArgs(['--once', '--order-id', orderId]), { orderId: orderId.toLowerCase() });
    for (const argv of [['--order-id'], ['--order-id', 'not-a-uuid'], ['--force'], ['--order-id', orderId, '--order-id', orderId]]) {
        assert.throws(() => parseArgs(argv), (error) => error.code === 'tg_worker_invalid_arguments');
    }
});

test('CLI validates provider configuration before constructing database or claiming any order', async () => {
    let databaseCalls = 0;
    await assert.rejects(runCli({
        argv: ['--once'], env: { TG_FULFILLMENT_ENABLED: 'true', SUPABASE_URL: 'https://database.test', SUPABASE_SERVICE_ROLE_KEY: 'server-test-key' },
        databaseFactory() { databaseCalls += 1; },
        clientFactory() { throw Object.assign(new Error('provider not configured'), { code: 'gramix_configuration_error' }); }
    }), (error) => error.code === 'gramix_configuration_error');
    assert.equal(databaseCalls, 0);
});

test('CLI only claims one order per invocation and treats an empty queue as success', async () => {
    let claims = 0;
    const result = await runCli({
        argv: ['--once'], env: { TG_FULFILLMENT_ENABLED: 'true', SUPABASE_URL: 'https://database.test', SUPABASE_SERVICE_ROLE_KEY: 'server-test-key' },
        databaseFactory() { return { async rpc(name) { claims += 1; assert.equal(name, 'fn_tg_claim_fulfillment_order'); return { data: { success: false, code: 'no_order' } }; } }; },
        clientFactory() { return {}; }
    });
    assert.deepEqual(result, { success: true, processed: false, code: 'no_order' });
    assert.equal(claims, 1);
});
