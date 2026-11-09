'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../services/kc-pay-gpt');
const runtime = path.join(root, 'mysql-store.js');
const runtimeRequire = createRequire(runtime);
const source = fs.readFileSync(process.env.KC_LOCAL_STORE_SOURCE || runtime, 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const task = patch => ({ id: 1, job_key: 'offline-job', cdk_code: 'OFFLINE-CDK', execution_mode: 'local_card_pool',
    status: 'running', payment_state: 'not_started', recovery_required: 0, finished_at: null,
    gpt_api_order_id: null, gpt_api_task_id: null, gpt_api_raw: null,
    session_payload: null, session_payload_encrypted: 'offline-encrypted-placeholder', ...patch });
const failed = patch => ({ cdkCode: 'OFFLINE-CDK', status: 'failed', paymentState: 'not_started',
    recoveryRequired: false, message: 'offline failed', progress: 25, ...patch });

// Offline model only. Serializing whole transactions cannot establish real
// MySQL row/gap lock behavior, isolation, disconnect or crash recovery.
function harness({ tasks = [task()], cdk = {}, fault = '', commit = '', rollbackError = false } = {}) {
    const state = { cdk: { cdk_code: 'OFFLINE-CDK', used_at: 'offline-held', is_active: 1, ...cdk }, tasks: clone(tasks) };
    const events = [];
    let gate = Promise.resolve(), serial = 0, commitFault = commit;
    function query(sql, params) {
        if (/FROM cdk_codes WHERE cdk_code/.test(sql)) return state.cdk && params[0] === state.cdk.cdk_code ? [clone(state.cdk)] : [];
        if (/SELECT \* FROM task_logs WHERE job_key/.test(sql)) return clone(state.tasks.filter(row => row.job_key === params[0]));
        if (/SELECT job_key FROM task_logs WHERE cdk_code/.test(sql)) return clone(state.tasks.filter(row => row.cdk_code === params[0]).sort((a, b) => b.id - a.id).slice(0, 1));
        if (/SELECT provider_task\.\*/.test(sql)) return clone(state.tasks.filter(row => row.cdk_code === params[0] && row.job_key !== params[1] && (
            ['running', 'manual'].includes(row.status) || row.recovery_required === 1 ||
            !['not_started', 'declined', 'succeeded'].includes(row.payment_state) || row.gpt_api_order_id || row.gpt_api_task_id
        )).slice(0, 1));
        throw new Error(`Unhandled offline query: ${sql}`);
    }
    function execute(sql, params) {
        if (/UPDATE\s+task_logs\s+SET status = \?/.test(sql)) {
            if (fault === 'task_write') throw new Error('offline task write failure');
            if (fault === 'task_cas') return { affectedRows: 0 };
            const row = state.tasks.find(row => row.job_key === params.at(-1));
            if (!row) return { affectedRows: 0 };
            // Execute the column assignments of the actual updateTaskLog SQL.
            const columns = ['status', 'message', 'raw_output', 'progress', 'cdk_code', 'phone', 'card_last4',
                'failure_screenshots', 'gpt_api_order_id', 'gpt_api_task_id', 'gpt_api_raw', 'gpt_api_topup_code',
                'execution_mode', 'auto_renew_status', 'auto_renew_message', 'payment_state', 'recovery_required'];
            columns.forEach((name, i) => { if (params[i] != null) row[name] = name === 'progress' ? Math.max(row.progress || 0, params[i]) : params[i]; });
            if (params[17]) row.finished_at ||= 'offline-finished';
            return { affectedRows: 1 };
        }
        if (/UPDATE task_logs SET session_payload = NULL/.test(sql)) {
            if (fault === 'session_clear') throw new Error('offline Session clearing failure');
            if (fault === 'session_cas') return { affectedRows: 0 };
            const row = state.tasks.find(row => row.job_key === params[0]);
            if (!row) return { affectedRows: 0 };
            row.session_payload = null; row.session_payload_encrypted = null;
            return { affectedRows: 1 };
        }
        if (/UPDATE\s+cdk_codes\s+SET\s+used_at = NULL/.test(sql)) {
            if (fault === 'release') throw new Error('offline CDK release failure');
            if (fault === 'release_cas') return { affectedRows: 0 };
            if (!state.cdk || params[0] !== state.cdk.cdk_code || !state.cdk.used_at) return { affectedRows: 0 };
            state.cdk.used_at = null; return { affectedRows: 1 };
        }
        throw new Error(`Unhandled offline mutation: ${sql}`);
    }
    const pool = {
        query: async (sql, params) => { events.push({ via: 'pool', sql }); return [query(sql, params)]; },
        execute: async (sql, params) => { events.push({ via: 'pool', sql }); return [execute(sql, params)]; },
        getConnection: async () => {
            const id = ++serial; let snapshot, committed = false, unlock;
            return {
                beginTransaction: async () => {
                    const previous = gate; gate = new Promise(resolve => { unlock = resolve; }); await previous;
                    snapshot = clone(state); events.push({ via: id, operation: 'begin' });
                },
                query: async (sql, params) => { events.push({ via: id, sql }); return [query(sql, params)]; },
                execute: async (sql, params) => { events.push({ via: id, sql }); return [execute(sql, params)]; },
                commit: async () => {
                    events.push({ via: id, operation: 'commit' }); const fail = commitFault; commitFault = '';
                    if (fail === 'before_apply') throw new Error('offline commit rejected');
                    committed = true; if (fail === 'after_apply') throw new Error('offline commit response lost');
                },
                rollback: async () => {
                    events.push({ via: id, operation: 'rollback' });
                    if (!committed && snapshot) Object.assign(state, clone(snapshot));
                    if (rollbackError) throw new Error('offline rollback failure');
                },
                release: () => { events.push({ via: id, operation: 'release' }); unlock?.(); }
            };
        }
    };
    const module = { exports: {} };
    vm.runInNewContext(source, { module, exports: module.exports, __dirname: root, Buffer, process, setTimeout, clearTimeout,
        console: { log() {}, warn() {}, error() {} },
        require: name => name === 'mysql2/promise' ? { createPool: () => pool } : runtimeRequire(name)
    }, { filename: runtime });
    const update = (patch = {}, options = {}) => module.exports.updateLocalActivationTask('offline-job', failed(patch), options);
    return { store: module.exports, state, events, update };
}

test('local settlement rolls back task result when CDK return fails', async () => {
    const h = harness({ fault: 'release' });
    const settle = h.store.updateLocalActivationTask ? () => h.update({}, { finalize: true }) : async () => {
        await h.store.updateTaskLog('offline-job', failed());
        await h.store.markCdkUnused('OFFLINE-CDK');
    };
    await assert.rejects(settle(), /CDK release failure/);
    assert.equal(h.state.tasks[0].status, 'running', 'failed result must not commit separately from CDK return');
    assert.equal(h.state.cdk.used_at, 'offline-held');
});

test('safe failure returns only its CDK and clears Session in the same transaction', async () => {
    const h = harness(); const result = await h.update({}, { finalize: true });
    assert.equal(result.applied, true); assert.equal(result.released, true);
    assert.equal(h.state.tasks[0].status, 'failed'); assert.equal(h.state.cdk.used_at, null);
    assert.equal(h.state.tasks[0].session_payload_encrypted, null);
    assert.equal(h.events.some(e => e.via === 'pool'), false);
    assert.equal(new Set(h.events.filter(e => e.sql).map(e => e.via)).size, 1);
    const locks = h.events.filter(e => e.sql?.includes('FOR UPDATE'));
    assert.match(locks[0].sql, /FROM cdk_codes/); assert.match(locks[1].sql, /FROM task_logs WHERE job_key/);
});
for (const fault of ['task_write', 'task_cas', 'session_clear', 'session_cas', 'release_cas']) {
    test(`local settlement rollback preserves both rows on ${fault}`, async () => {
        const h = harness({ fault }); const before = clone(h.state);
        await assert.rejects(h.update({}, { finalize: true })); assert.deepEqual(h.state, before);
    });
}
for (const paymentState of ['started', 'unknown', 'succeeded', null, 'unrecognized']) {
    test(`persisted ${paymentState} cannot be downgraded by a safe failure`, async () => {
        const h = harness({ tasks: [task({ payment_state: paymentState })] });
        const result = await h.update({}, { finalize: true });
        assert.equal(result.released, false); assert.equal(result.status, 'manual');
        assert.equal(result.recoveryRequired, true); assert.equal(h.state.cdk.used_at, 'offline-held');
        assert.notEqual(h.state.tasks[0].payment_state, 'not_started');
    });
}
for (const patch of [
    { execution_mode: 'third_party_api' }, { execution_mode: 'legacy_unknown' },
    { gpt_api_order_id: 'offline-provider-order' }, { gpt_api_task_id: 'offline-provider-task' },
    { gpt_api_raw: '{}' }, { cdk_code: 'OTHER-CDK' }, { status: 'failed', finished_at: 'offline-finished' },
    { status: 'success', payment_state: 'succeeded', finished_at: 'offline-finished' },
    { status: 'cancelled' }, { status: 'maintenance' }
]) {
    test(`refuses incompatible, completed or foreign task ${JSON.stringify(patch)}`, async () => {
        const h = harness({ tasks: [task(patch)] }); const before = clone(h.state);
        const result = await h.update({}, { finalize: true }); assert.equal(result.applied, false); assert.deepEqual(h.state, before);
    });
}
for (const cdk of [{ used_at: null }, { is_active: 0 }]) {
    test(`unavailable CDK does not become reusable ${JSON.stringify(cdk)}`, async () => {
        const h = harness({ cdk }); const result = await h.update({}, { finalize: true });
        assert.equal(result.released, false); assert.equal(h.state.cdk.used_at, cdk.used_at === null ? null : 'offline-held');
    });
}
test('late old task cannot return or modify a newer owner CDK', async () => {
    const h = harness({ tasks: [task(), task({ id: 2, job_key: 'newer-offline-job' })] });
    const before = clone(h.state); const result = await h.update({}, { finalize: true });
    assert.equal(result.applied, false); assert.deepEqual(h.state, before);
});
test('another unresolved task blocks safe release even if current task is newest', async () => {
    const h = harness({ tasks: [task({ id: 2 }), task({ id: 1, job_key: 'older-offline-job', payment_state: 'unknown' })] });
    const before = clone(h.state); assert.equal((await h.update({}, { finalize: true })).applied, false); assert.deepEqual(h.state, before);
});
test('duplicate completion is idempotent and a late payment callback cannot resurrect it', async () => {
    const h = harness(); await h.update({}, { finalize: true }); const before = clone(h.state);
    assert.equal((await h.update({}, { finalize: true })).applied, false);
    assert.equal((await h.update({ status: 'running', paymentState: 'started' })).applied, false);
    assert.deepEqual(h.state, before);
});
test('concurrent finalizations return the CDK once in the offline serial model', async () => {
    const h = harness(); const results = await Promise.all(Array.from({ length: 12 }, () => h.update({}, { finalize: true })));
    assert.equal(results.filter(r => r.released).length, 1); assert.equal(results.filter(r => r.applied).length, 1);
});
test('intermediate unknown state stays recoverable until an affirmative success', async () => {
    const h = harness(); await h.update({ status: 'manual', paymentState: 'unknown', recoveryRequired: true });
    assert.equal(h.state.tasks[0].finished_at, null); assert.equal(h.state.cdk.used_at, 'offline-held');
    const result = await h.update({ status: 'success', paymentState: 'succeeded' }, { finalize: true });
    assert.equal(result.status, 'success'); assert.equal(result.released, false);
    assert.equal(h.state.tasks[0].session_payload_encrypted, null);
});
test('post-success auto-renew annotation can require review without returning CDK', async () => {
    const h = harness(); await h.update({ status: 'success', paymentState: 'succeeded' }, { finalize: true });
    const result = await h.update({ status: 'manual', paymentState: 'succeeded', recoveryRequired: true,
        autoRenewStatus: 'verification_unknown' }, { annotate: true });
    assert.equal(result.applied, true); assert.equal(result.released, false); assert.equal(result.status, 'manual');
    assert.equal(h.state.cdk.used_at, 'offline-held');
    assert.equal((await h.update({}, { finalize: true })).applied, false);
});
test('pending auto-renew completion can become success without returning CDK or restoring Session', async () => {
    const h = harness();
    const pending = await h.update({ status: 'manual', paymentState: 'succeeded', recoveryRequired: true,
        autoRenewStatus: 'pending' }, { finalize: true });
    assert.equal(pending.status, 'manual'); assert.equal(pending.recoveryRequired, true);
    assert.equal(h.state.tasks[0].auto_renew_status, 'pending');
    assert.equal(h.state.tasks[0].session_payload_encrypted, null);
    const result = await h.update({ status: 'success', paymentState: 'succeeded', autoRenewStatus: 'disabled',
        recoveryRequired: false }, { annotate: true });
    assert.equal(result.status, 'success'); assert.equal(result.recoveryRequired, false);
    assert.equal(result.released, false); assert.equal(h.state.cdk.used_at, 'offline-held');
    assert.equal(h.state.tasks[0].auto_renew_status, 'disabled');
    assert.equal(h.state.tasks[0].session_payload_encrypted, null);
});
test('failed auto-renew annotation preserves the committed pending result', async () => {
    const h = harness({ fault: 'task_write', tasks: [task({ status: 'manual', payment_state: 'succeeded',
        recovery_required: 1, finished_at: 'offline-finished', auto_renew_status: 'pending',
        session_payload_encrypted: null })] });
    const before = clone(h.state);
    await assert.rejects(h.update({ status: 'success', paymentState: 'succeeded', autoRenewStatus: 'disabled',
        recoveryRequired: false }, { annotate: true }), /task write failure/);
    assert.deepEqual(h.state, before);
});
test('late auto-renew annotation cannot change a task after the CDK gains another owner', async () => {
    const h = harness({ tasks: [task({ status: 'manual', payment_state: 'succeeded', recovery_required: 1,
        finished_at: 'offline-finished', auto_renew_status: 'pending' }),
        task({ id: 2, job_key: 'newer-offline-job' })] });
    const before = clone(h.state);
    const result = await h.update({ status: 'success', paymentState: 'succeeded', autoRenewStatus: 'disabled' }, { annotate: true });
    assert.equal(result.applied, false); assert.equal(result.reason, 'CDK_OWNER_MISMATCH');
    assert.deepEqual(h.state, before);
});
for (const commit of ['before_apply', 'after_apply']) {
    test(`commit uncertainty ${commit} never triggers a separate CDK unlock`, async () => {
        const h = harness({ commit }); await assert.rejects(h.update({}, { finalize: true }), /commit/);
        assert.equal(h.events.some(e => e.via === 'pool'), false);
        assert.equal(h.state.cdk.used_at, commit === 'before_apply' ? 'offline-held' : null);
        const retry = await h.update({}, { finalize: true });
        assert.equal(retry.applied, commit === 'before_apply');
    });
}
test('rollback failure does not replace the original transaction failure', async () => {
    const h = harness({ fault: 'release', rollbackError: true });
    await assert.rejects(h.update({}, { finalize: true }), /CDK release failure/);
    assert.equal(h.events.at(-1).operation, 'release');
});
