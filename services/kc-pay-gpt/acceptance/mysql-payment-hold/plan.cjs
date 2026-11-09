'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { validateRunId, digest, USER, PORT } = require('./safety.cjs');
const RUNTIME = ['mysql-store.js', 'payment-retry.js', 'stripe-protocol-payment.js', 'mysql-schema.sql'];
const SCENARIOS = [
    'exact_owner_and_single_hold', 'concurrent_reserve', 'pending_hold_cleanup',
    'unsafe_task_cleanup', 'confirmed_no_charge_cleanup', 'hold_cleanup_race',
    'database_deadlock', 'disconnect_uncommitted', 'disconnect_before_commit',
    'discard_commit_ack', 'discard_hold_ack', 'reload_store_preserves_hold'
];
const MANUAL = ['tcp_commit_reply_loss', 'worker_process_restart', 'mysqld_crash_restart'];
function sourceHashes() {
    return Object.fromEntries(RUNTIME.map(name => [name, digest(fs.readFileSync(path.resolve(__dirname, '../..', name)))]));
}
function makePlan(runId = crypto.randomBytes(8).toString('hex')) {
    validateRunId(runId);
    const database = `kc_fault_lab_${runId}`;
    const sql = fs.readFileSync(path.join(__dirname, 'fixture.sql'), 'utf8')
        .replaceAll('__GRANT_DATABASE__', database.replaceAll('_', '\\_'))
        .replaceAll('__DATABASE__', database).replaceAll('__RUN_ID__', runId);
    return {
        mode: 'PLAN_ONLY', connected: false, sqlExecuted: false, runId,
        boundary: 'Disposable synthetic MySQL 8.4 only; operator must exclude production port forwarding.',
        sourceHashes: sourceHashes(),
        targetTemplate: { runId, host: '127.0.0.1', port: PORT, database, user: USER,
            serverUuid: 'REPLACE_WITH_DISPOSABLE_SERVER_UUID' },
        fixtureSql: sql,
        scenarios: SCENARIOS.map(id => ({ id, status: 'NOT RUN' })),
        manualScenarios: MANUAL.map(id => ({ id, status: 'NOT RUN' }))
    };
}
module.exports = { RUNTIME, SCENARIOS, MANUAL, sourceHashes, makePlan };
