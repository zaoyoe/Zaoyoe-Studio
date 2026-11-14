'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');

const serviceRoot = path.resolve(__dirname, '../services/kc-pay-gpt');
const runtimePath = path.join(serviceRoot, 'mysql-store.js');
const runtimeRequire = createRequire(runtimePath);
const source = fs.readFileSync(process.env.KC_ATOMIC_STORE_SOURCE || runtimePath, 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const expectedCdk = { platform: 'grok', plan_type: 'grok-pro', payment_region: 'US' };
const input = () => ({ expectedCdk: { ...expectedCdk }, cdkCode: 'OFFLINE-CDK', tokenPreview: 'offline-preview',
    sessionPayload: 'offline-synthetic-session', executionMode: 'local_card_pool', progress: 8 });
const safeTask = (patch = {}) => ({ id: 1, job_key: 'offline-job', cdk_code: 'OFFLINE-CDK', execution_mode: 'local_card_pool',
    status: 'running', payment_state: 'not_started', recovery_required: 0,
    gpt_api_order_id: null, gpt_api_task_id: null, gpt_api_raw: null,
    session_payload: null, session_payload_encrypted: 'synthetic-encrypted-placeholder', ...patch });

// An offline stateful transaction model executes the actual store module. Its
// mutex serializes whole transactions; it does not model MySQL row/gap locks,
// isolation levels, connection loss or an actual process being killed.
function harness({ cdk = {}, tasks = [], fail = '', commit = '', encryptionError = false } = {}) {
    const state = { cdk: { cdk_code: 'OFFLINE-CDK', type: '自助', is_active: 1, used_at: null,
        activation_cooling_down: 0, ...expectedCdk, ...cdk }, tasks: clone(tasks) };
    const events = [];
    let gate = Promise.resolve();
    let sequence = 0;
    let commitFault = commit;
    function queryRows(sql, params) {
        if (/FROM cdk_codes WHERE cdk_code/.test(sql)) return state.cdk && state.cdk.cdk_code === params[0] ? [clone(state.cdk)] : [];
        if (/SELECT provider_task\.\*/.test(sql)) {
            assert.match(sql, /FOR UPDATE/);
            assert.match(sql, /recovery_required = 1/);
            assert.match(sql, /COALESCE\(provider_task.payment_state, 'unknown'\)/);
            return clone(state.tasks.filter(row => row.cdk_code === params[0] && row.job_key !== params[1] && (
                ['running', 'manual'].includes(row.status) || row.recovery_required === 1 ||
                !['not_started', 'declined', 'succeeded'].includes(row.payment_state) ||
                ((row.execution_mode === 'third_party_api' || row.gpt_api_order_id != null || row.gpt_api_task_id != null) &&
                    (row.gpt_api_order_id != null || row.gpt_api_task_id != null || /"dispatchStarted":true/.test(row.gpt_api_raw || '')))
            )).sort((a, b) => b.id - a.id).slice(0, 1));
        }
        if (/SELECT \* FROM task_logs WHERE job_key/.test(sql)) return clone(state.tasks.filter(row => row.job_key === params[0]));
        if (/SELECT job_key, status, message, progress, updated_at/.test(sql)) return clone(state.tasks.filter(row => row.cdk_code === params[0] && row.status === 'running').sort((a, b) => b.id - a.id).slice(0, 1));
        if (/SELECT job_key FROM task_logs WHERE cdk_code/.test(sql)) return clone(state.tasks.filter(row => row.cdk_code === params[0]).sort((a, b) => b.id - a.id).slice(0, 1).map(row => ({ job_key: row.job_key })));
        throw new Error(`Unhandled offline SELECT: ${sql}`);
    }
    function mutate(sql, params) {
        if (/UPDATE\s+cdk_codes\s+SET\s+used_at\s*=\s*CURRENT_TIMESTAMP/.test(sql)) {
            if (fail === 'consume') return { affectedRows: 0 };
            if (!state.cdk || state.cdk.used_at || state.cdk.is_active !== 1) return { affectedRows: 0 };
            state.cdk.used_at = 'offline-consumed'; return { affectedRows: 1 };
        }
        if (/INSERT INTO task_logs/.test(sql)) {
            if (fail === 'insert') throw new Error('offline INSERT failure');
            const id = Math.max(0, ...state.tasks.map(row => row.id)) + 1;
            const colsMatch = sql.match(/INSERT INTO task_logs\s*\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\)/i);
            const rowValues = {};
            if (colsMatch) {
                const colNames = colsMatch[1].split(',').map(s => s.trim());
                const valExprs = colsMatch[2].split(',').map(s => s.trim());
                let pIdx = 0;
                colNames.forEach((col, idx) => {
                    if (valExprs[idx] === '?') rowValues[col] = params[pIdx++];
                });
            }
            state.tasks.push(safeTask({
                id,
                job_key: rowValues.job_key ?? params[0],
                token_preview: rowValues.token_preview ?? params[1],
                session_payload_encrypted: rowValues.session_payload_encrypted ?? params[2],
                session_fingerprint: rowValues.session_fingerprint ?? params[3],
                execution_mode: rowValues.execution_mode ?? params[4],
                cdk_code: rowValues.cdk_code ?? params[5],
                platform: rowValues.platform,
                plan_type: rowValues.plan_type,
                status: rowValues.status ?? params[8],
                payment_state: rowValues.payment_state ?? params[12]
            }));
            return { affectedRows: 1, insertId: id };
        }
        if (/UPDATE task_logs SET status = 'failed'/.test(sql)) {
            if (fail === 'retire') throw new Error('offline retirement failure');
            if (fail === 'retire_cas') return { affectedRows: 0 };
            const row = state.tasks.find(row => row.job_key === params[1] && row.status === 'running');
            if (!row) return { affectedRows: 0 };
            Object.assign(row, { status: 'failed', message: params[0], progress: 0, session_payload: null, session_payload_encrypted: null });
            return { affectedRows: 1 };
        }
        if (/UPDATE cdk_codes SET used_at = NULL/.test(sql)) {
            if (fail === 'release') throw new Error('offline CDK return failure');
            if (fail === 'release_cas') return { affectedRows: 0 };
            if (!state.cdk || state.cdk.cdk_code !== params[0] || !state.cdk.used_at) return { affectedRows: 0 };
            state.cdk.used_at = null; return { affectedRows: 1 };
        }
        throw new Error(`Unhandled offline mutation: ${sql}`);
    }
    const pool = {
        execute: async (sql, params) => { events.push({ via: 'pool', sql, params }); return [mutate(sql, params)]; },
        query: async (sql, params) => { events.push({ via: 'pool', sql, params }); return [queryRows(sql, params)]; },
        getConnection: async () => {
            const id = ++sequence;
            let snapshot, committed = false, unlock;
            return {
                beginTransaction: async () => {
                    const previous = gate;
                    gate = new Promise(resolve => { unlock = resolve; });
                    await previous;
                    snapshot = clone(state); events.push({ via: id, operation: 'begin' });
                    if (fail === 'deadlock') throw new Error('offline ER_LOCK_DEADLOCK');
                },
                query: async (sql, params) => { events.push({ via: id, sql, params }); return [queryRows(sql, params)]; },
                execute: async (sql, params) => { events.push({ via: id, sql, params }); return [mutate(sql, params)]; },
                commit: async () => {
                    events.push({ via: id, operation: 'commit' });
                    const fault = commitFault;
                    commitFault = '';
                    if (fault === 'before_apply') throw new Error('offline commit rejected');
                    committed = true;
                    if (fault === 'after_apply') throw new Error('offline commit response lost');
                },
                rollback: async () => {
                    events.push({ via: id, operation: 'rollback' });
                    if (!committed && snapshot) Object.assign(state, clone(snapshot));
                },
                release: () => { events.push({ via: id, operation: 'release' }); if (unlock) unlock(); }
            };
        }
    };
    const module = { exports: {} };
    // Load the real AES-GCM implementation with an isolated synthetic key. The
    // offline suite must not depend on, or modify, the operator's environment.
    const sessionModule = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(serviceRoot, 'session-security.js'), 'utf8'), {
        module: sessionModule, exports: sessionModule.exports, Buffer,
        process: { env: { KC_SESSION_ENCRYPTION_KEY: 'offline-atomic-fixture-key-32-bytes-minimum' } },
        require: runtimeRequire
    }, { filename: path.join(serviceRoot, 'session-security.js') });
    const sessions = sessionModule.exports;
    const context = { module, exports: module.exports, __dirname: serviceRoot, Buffer, process,
        console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout,
        require(name) {
            if (name === 'mysql2/promise') return { createPool: () => pool };
            if (name === './session-security') return encryptionError
                ? { ...sessions, encryptSessionPayload() { throw new Error('offline encryption unavailable'); } }
                : sessions;
            return runtimeRequire(name);
        }
    };
    vm.runInNewContext(source, context, { filename: runtimePath });
    return { state, events, store: module.exports, sessions };
}
async function admit(h, data = input()) {
    if (h.store.createActivationTask) return h.store.createActivationTask(data);
    // Only used to execute the pre-change backup with the same fault injection.
    await h.store.markCdkUsed(data.cdkCode);
    return h.store.createTaskLog({ ...data, status: 'running' });
}
function assertConnectionOnly(h) {
    assert.equal(h.events.filter(event => event.sql && event.via === 'pool').length, 0);
    assert.equal(new Set(h.events.filter(event => event.sql).map(event => event.via)).size, 1);
}

test('atomic admission rolls back CDK consumption when task INSERT fails', async () => {
    const h = harness({ fail: 'insert' });
    await assert.rejects(admit(h), /INSERT failure/);
    assert.equal(h.state.cdk.used_at, null, 'CDK must remain usable when no task was committed');
    assert.equal(h.state.tasks.length, 0);
    assertConnectionOnly(h);
});
test('atomic admission encrypts Session and commits the task on the consuming connection', async () => {
    const h = harness();
    const task = await admit(h);
    assert.equal(task.created, true);
    assert.equal(h.state.tasks.length, 1);
    assert.equal(h.state.cdk.used_at, 'offline-consumed');
    assert.equal(h.state.tasks[0].status, 'running');
    assert.equal(h.state.tasks[0].payment_state, 'not_started');
    assert.equal(h.state.tasks[0].session_payload, null);
    assert.match(h.state.tasks[0].session_payload_encrypted, /^v1:/);
    assert.equal(h.sessions.decryptSessionPayload(h.state.tasks[0].session_payload_encrypted), input().sessionPayload);
    assertConnectionOnly(h);
});
for (const [label, options] of [['encryption failure', { encryptionError: true }], ['commit rejection', { commit: 'before_apply' }], ['CDK CAS conflict', { fail: 'consume' }], ['deadlock victim', { fail: 'deadlock' }]]) {
    test(`atomic admission leaves no orphan consumption after ${label}`, async () => {
        const h = harness(options);
        await assert.rejects(admit(h));
        assert.equal(h.state.cdk.used_at, null);
        assert.equal(h.state.tasks.length, 0);
        assert.equal(h.events.at(-1).operation, 'release');
    });
}
test('lost COMMIT response keeps both task and CDK, and retry resumes without inserting again', async () => {
    const h = harness({ commit: 'after_apply' });
    await assert.rejects(admit(h), /response lost/);
    assert.equal(h.state.tasks.length, 1);
    assert.equal(h.state.cdk.used_at, 'offline-consumed');
    const resumed = await admit(h);
    assert.equal(resumed.created, false);
    assert.equal(resumed.jobKey, h.state.tasks[0].job_key);
    assert.equal(h.state.tasks.length, 1);
    assert.equal(h.events.filter(event => /INSERT INTO task_logs/.test(event.sql || '')).length, 1);
});
test('concurrent admission in the serialized transaction model creates only one task', async () => {
    const h = harness();
    const results = await Promise.all(Array.from({ length: 12 }, () => admit(h)));
    assert.equal(results.filter(result => result.created).length, 1);
    assert.equal(new Set(results.map(result => result.jobKey)).size, 1);
    assert.equal(h.state.tasks.length, 1);
});
for (const [label, patch] of [['disabled', { is_active: 0 }], ['used', { used_at: 'offline-used' }], ['non-self-service', { type: '人工' }], ['cooling down', { activation_cooling_down: 1 }],
    ['changed platform', { platform: 'claude' }], ['changed plan', { plan_type: 'another' }], ['changed region', { payment_region: 'PH' }]]) {
    test(`transaction rechecks ${label} CDKs`, async () => {
        const h = harness({ cdk: patch });
        const before = clone(h.state);
        await assert.rejects(admit(h));
        assert.deepEqual(h.state, before);
    });
}
test('transaction rejects a deleted CDK', async () => {
    const h = harness(); h.state.cdk = null;
    await assert.rejects(admit(h));
    assert.equal(h.state.tasks.length, 0);
});
for (const patch of [{ status: 'manual' }, { status: 'failed', payment_state: 'unknown' }, { status: 'failed', recovery_required: 1 },
    { status: 'failed', execution_mode: 'third_party_api', gpt_api_order_id: 'offline-order' },
    { status: 'failed', execution_mode: 'third_party_api', gpt_api_raw: '{"attempt":{"dispatchStarted":true}}' }]) {
    test(`admission blocks unresolved prior task: ${JSON.stringify(patch)}`, async () => {
        const h = harness({ tasks: [safeTask(patch)] });
        await assert.rejects(admit(h));
        assert.equal(h.state.cdk.used_at, null);
        assert.equal(h.state.tasks.length, 1);
    });
}
test('admission refuses incomplete binding and unknown execution mode before opening a transaction', async () => {
    for (const patch of [{ expectedCdk: {} }, { executionMode: 'legacy_unknown' }, { cdkCode: '' }]) {
        const h = harness();
        await assert.rejects(admit(h, { ...input(), ...patch }));
        assert.equal(h.events.length, 0);
    }
});
test('task-owned retirement atomically clears Session, finishes the task and returns its CDK', async () => {
    const h = harness({ cdk: { used_at: 'offline-used' }, tasks: [safeTask()] });
    assert.equal((await h.store.retireSafeActivationTask('offline-job')).released, true);
    assert.equal(h.state.tasks[0].status, 'failed');
    assert.equal(h.state.tasks[0].session_payload_encrypted, null);
    assert.equal(h.state.cdk.used_at, null);
    assertConnectionOnly(h);
    assert.equal((await h.store.retireSafeActivationTask('offline-job')).released, false);
});
for (const failure of ['retire', 'retire_cas', 'release', 'release_cas']) {
    test(`retirement rolls back both writes after ${failure} failure`, async () => {
        const h = harness({ fail: failure, cdk: { used_at: 'offline-used' }, tasks: [safeTask()] });
        const before = clone(h.state);
        await assert.rejects(h.store.retireSafeActivationTask('offline-job'));
        assert.deepEqual(h.state, before);
    });
}
for (const commit of ['before_apply', 'after_apply']) {
    test(`retirement preserves a consistent task and CDK after ${commit} commit failure`, async () => {
        const h = harness({ commit, cdk: { used_at: 'offline-used' }, tasks: [safeTask()] });
        const before = clone(h.state);
        await assert.rejects(h.store.retireSafeActivationTask('offline-job'), /commit/);
        if (commit === 'before_apply') assert.deepEqual(h.state, before);
        else {
            assert.equal(h.state.tasks[0].status, 'failed');
            assert.equal(h.state.tasks[0].session_payload_encrypted, null);
            assert.equal(h.state.cdk.used_at, null);
            assert.equal((await h.store.retireSafeActivationTask('offline-job')).released, false);
        }
    });
}
for (const payment_state of ['started', 'unknown', 'succeeded', 'declined', null]) {
    test(`retirement retains a task whose payment state is ${payment_state}`, async () => {
        const h = harness({ cdk: { used_at: 'offline-used' }, tasks: [safeTask({ payment_state })] });
        assert.equal((await h.store.retireSafeActivationTask('offline-job')).released, false);
        assert.equal(h.state.cdk.used_at, 'offline-used');
        assert.equal(h.state.tasks[0].status, 'running');
    });
}
for (const patch of [{ status: 'manual' }, { recovery_required: 1 }, { execution_mode: 'legacy_unknown' },
    { gpt_api_order_id: 'offline-order' }, { gpt_api_task_id: 'offline-provider-task' }, { gpt_api_raw: '{}' }]) {
    test(`retirement refuses risk evidence: ${JSON.stringify(patch)}`, async () => {
        const h = harness({ cdk: { used_at: 'offline-used' }, tasks: [safeTask(patch)] });
        assert.equal((await h.store.retireSafeActivationTask('offline-job')).released, false);
        assert.equal(h.state.cdk.used_at, 'offline-used');
    });
}
test('startup recovery may retire only an explicitly declined local task', async () => {
    for (const [mode, released] of [['local_card_pool', true], ['third_party_api', false]]) {
        const h = harness({ cdk: { used_at: 'offline-used' }, tasks: [safeTask({ execution_mode: mode, payment_state: 'declined' })] });
        assert.equal((await h.store.retireSafeActivationTask('offline-job', { allowDeclined: true })).released, released);
    }
});
test('late old-task retirement never releases the newer owner CDK', async () => {
    const h = harness({ cdk: { used_at: 'offline-new-owner' }, tasks: [safeTask(), safeTask({ id: 2, job_key: 'new-owner', status: 'failed', payment_state: 'declined' })] });
    assert.equal((await h.store.retireSafeActivationTask('offline-job')).released, false);
    assert.equal(h.state.cdk.used_at, 'offline-new-owner');
    assert.equal(h.state.tasks[0].status, 'running');
});
test('another unresolved task blocks retirement even when the retiring task is the latest owner', async () => {
    const h = harness({ cdk: { used_at: 'offline-used' }, tasks: [safeTask({ id: 1, job_key: 'older', status: 'manual' }), safeTask({ id: 2 })] });
    assert.equal((await h.store.retireSafeActivationTask('offline-job')).released, false);
    assert.equal(h.state.cdk.used_at, 'offline-used');
});
test('retirement refuses an inactive or already unheld CDK', async () => {
    for (const patch of [{ is_active: 0, used_at: 'offline-used' }, { used_at: null }]) {
        const h = harness({ cdk: patch, tasks: [safeTask()] });
        assert.equal((await h.store.retireSafeActivationTask('offline-job')).released, false);
        assert.equal(h.state.tasks[0].status, 'running');
    }
});
test('diagnostic createTaskLog remains callable outside an activation transaction', async () => {
    const h = harness();
    const task = await h.store.createTaskLog({ ...input(), executionMode: 'checkout_diagnostic', status: 'running' });
    assert.ok(task.jobKey);
    assert.equal(h.state.cdk.used_at, null);
    assert.equal(h.state.tasks[0].execution_mode, 'checkout_diagnostic');
    assert.equal(h.events[0].via, 'pool');
});

// Exercise the actual HTTP admission handler with the actual store primitive,
// replacing only its non-transactional preflight and worker side effects.
function handler(h, { dispatchError = false } = {}) {
    const server = fs.readFileSync(path.join(serviceRoot, 'server.js'), 'utf8');
    const start = server.indexOf('async function handleActivationRequest(req, res) {');
    const end = server.indexOf("\napp.post('/api/run-process'", start);
    const slots = ['reserveForegroundSlot', 'releaseForegroundSlot'].map(name => {
        const begin = server.indexOf(`function ${name}(`);
        return server.slice(begin, server.indexOf('\n}', begin) + 2);
    }).join('\n');
    const dispatched = [], unlocks = [], retirements = [], activeForegroundJobs = new Set();
    const context = { crypto, activeForegroundJobs, console: { log() {}, error() {} },
        getClientIp: () => '', ensureStoreReady: async () => {}, getRemainingCooldownMinutes: () => 0,
        resolveActivationInput: () => ({ platform: 'grok', planType: 'grok-pro', token: 'offline-token',
            storedSession: input().sessionPayload, tokenPreview: 'offline-preview' }),
        logTask() {}, issueTaskAccessToken: key => `offline-access-${key}`, redactSensitiveText: String,
        formatTaskErrorMessage: (_status, message) => message,
        spawnActivationWorker(data) { dispatched.push(data); if (dispatchError) throw new Error('offline uncertain dispatch'); },
        store: { ...h.store,
            getMaintenanceModeState: async () => ({ enabled: false }), getMaxConcurrentActivations: async () => 3,
            verifyCdkDetails: async () => clone(h.state.cdk),
            hasAvailableCard: async () => true,
            markCdkUnused: async cdk => { unlocks.push(cdk); throw new Error('unscoped unlock forbidden'); },
            retireSafeActivationTask: async key => { retirements.push(key); return h.store.retireSafeActivationTask(key); }
        }
    };
    vm.runInNewContext(`${slots}\n${server.slice(start, end)}\nthis.handle = handleActivationRequest`, context);
    return { dispatched, unlocks, retirements, activeForegroundJobs, async run() {
        const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
        await context.handle({ path: '/api/run-process', body: { session: 'offline-session', cdk: 'OFFLINE-CDK' } }, res);
        return res;
    } };
}
test('HTTP handler preserves committed consumption after a lost COMMIT response', async () => {
    const h = harness({ commit: 'after_apply' }), app = handler(h);
    assert.equal((await app.run()).code, 500);
    assert.equal(h.state.tasks.length, 1);
    assert.equal(h.state.cdk.used_at, 'offline-consumed');
    assert.equal(app.dispatched.length, 0);
    assert.equal(app.unlocks.length, 0);
    assert.equal(app.retirements.length, 0);
    assert.equal(app.activeForegroundJobs.size, 0);
});
test('HTTP retry after a lost COMMIT response resumes its persisted task without dispatching again', async () => {
    const h = harness({ commit: 'after_apply' }), app = handler(h);
    assert.equal((await app.run()).code, 500);
    const resumed = await app.run();
    assert.equal(resumed.code, 200);
    assert.equal(resumed.body.success, true);
    assert.equal(resumed.body.jobKey, h.state.tasks[0].job_key);
    assert.equal(resumed.body.taskAccessToken, `offline-access-${h.state.tasks[0].job_key}`);
    assert.equal(h.state.tasks.length, 1);
    assert.equal(h.state.cdk.used_at, 'offline-consumed');
    assert.equal(app.dispatched.length, 0);
    assert.equal(app.unlocks.length, 0);
    assert.equal(app.retirements.length, 0);
    assert.equal(app.activeForegroundJobs.size, 0);
});
test('HTTP handler retains the committed task after entering an uncertain dispatch', async () => {
    const h = harness(), app = handler(h, { dispatchError: true });
    assert.equal((await app.run()).code, 500);
    assert.equal(h.state.tasks[0].status, 'running');
    assert.equal(h.state.cdk.used_at, 'offline-consumed');
    assert.equal(app.dispatched.length, 1);
    assert.equal(app.unlocks.length, 0);
    assert.equal(app.retirements.length, 0);
    assert.equal(app.activeForegroundJobs.size, 1);
});

test('startup recovery rechecks current payment evidence instead of releasing from a stale snapshot', async () => {
    const h = harness({ cdk: { used_at: 'offline-used' }, tasks: [safeTask({ payment_state: 'unknown' })] });
    const before = clone(h.state);
    const server = fs.readFileSync(path.join(serviceRoot, 'server.js'), 'utf8');
    const start = server.indexOf('        const staleTasks = await store.listRunningTasksForRecovery();');
    const end = server.indexOf('    } catch (error) {\n        console.error(`❌ [任务恢复]', start);
    assert.ok(start >= 0 && end > start);
    const logs = [], updates = [], unlocks = [];
    await vm.runInNewContext(`(async () => {${server.slice(start, end)}})()`, {
        store: { ...h.store,
            listRunningTasksForRecovery: async () => [safeTask()],
            updateTaskLog: async (...args) => updates.push(args),
            markCdkUnused: async (...args) => unlocks.push(args), resetAllAssetLocks: async () => {}
        },
        classifyInterruptedTask: runtimeRequire('./task-safety').classifyInterruptedTask,
        recoverInterruptedCheckoutDiagnostic: async () => false,
        logTask: (...args) => logs.push(args), console: { log() {} }
    });
    assert.deepEqual(h.state, before);
    assert.equal(updates.length, 0);
    assert.equal(unlocks.length, 0);
    assert.equal(logs.length, 1);
    assert.match(logs[0][1], /保留任务及 CDK/);
});
