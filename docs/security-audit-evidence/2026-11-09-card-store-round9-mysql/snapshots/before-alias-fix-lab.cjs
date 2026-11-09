'use strict';
const { validateTarget, requireThat, LabError, PURPOSE, TABLES, USER, PASSWORD, errorCode } = require('./safety.cjs');
const { loadStore, transactionFaultPool, autocommitFaultPool } = require('./store-loader.cjs');
const { SCENARIOS, MANUAL, sourceHashes } = require('./plan.cjs');

// This module never loads a driver or opens a connection at import time.
function poolOptions(target) {
    validateTarget(target);
    return { host: target.host, port: target.port, database: target.database, user: USER, password: PASSWORD,
        charset: 'utf8mb4_unicode_ci', connectTimeout: 2000, connectionLimit: 4,
        waitForConnections: true, queueLimit: 8, multipleStatements: false,
        namedPlaceholders: false, flags: ['-LOCAL_FILES'] };
}
function boundedPool(raw, timeoutMs = 5000) {
    requireThat(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 5000, 'LAB_INVALID_TIMEOUT');
    const active = new Set();
    let closed = false;
    async function acquire() {
        requireThat(!closed, 'LAB_POOL_CLOSED');
        let expired = false, timer;
        try {
            return await Promise.race([
                Promise.resolve().then(() => raw.getConnection()).then(c => {
                    if (expired || closed) { c.destroy(); throw new LabError('LAB_POOL_CLOSED'); }
                    active.add(c); return c;
                }),
                new Promise((_, reject) => { timer = setTimeout(() => {
                    expired = true; reject(new LabError('LAB_ACQUIRE_TIMEOUT'));
                }, timeoutMs); })
            ]);
        } finally { clearTimeout(timer); }
    }
    async function getConnection() {
        const c = await acquire();
        let destroyed = false;
        const destroy = () => {
            if (!destroyed) {
                destroyed = true; active.delete(c);
                try { c.destroy(); } catch (_) { /* cleanup must not replace the query error */ }
            }
        };
        const timed = async (method, sql, params) => {
            requireThat(!destroyed && !closed, 'LAB_CONNECTION_CLOSED');
            let timer;
            try {
                return await Promise.race([
                    Promise.resolve().then(() => c[method]({ sql, timeout: timeoutMs }, params)),
                    new Promise((_, reject) => { timer = setTimeout(() => {
                        destroy(); reject(new LabError('LAB_QUERY_TIMEOUT'));
                    }, timeoutMs); })
                ]);
            } catch (error) {
                // A driver failure may arrive before our deadline. Never pool a
                // connection whose transaction/response state is now uncertain.
                destroy(); throw error;
            } finally { clearTimeout(timer); }
        };
        const wrapped = {
            query: (sql, params) => timed('query', sql, params),
            execute: (sql, params) => timed('execute', sql, params),
            beginTransaction: () => timed('query', 'START TRANSACTION'),
            commit: () => timed('query', 'COMMIT'),
            rollback: () => timed('query', 'ROLLBACK'),
            release() { if (!destroyed) { destroyed = true; active.delete(c); c.release(); } },
            destroy
        };
        try { await wrapped.query('SET SESSION innodb_lock_wait_timeout = 2'); }
        catch (error) { destroy(); throw error; }
        return wrapped;
    }
    async function withConnection(method, sql, params) {
        const c = await getConnection();
        try { return await c[method](sql, params); } finally { c.release(); }
    }
    return {
        query: (sql, params) => withConnection('query', sql, params),
        execute: (sql, params) => withConnection('execute', sql, params),
        getConnection,
        async end() {
            closed = true;
            for (const c of active) c.destroy();
            active.clear();
            let timer;
            try { await Promise.race([raw.end(), new Promise((_, reject) => {
                timer = setTimeout(() => reject(new LabError('LAB_CLOSE_TIMEOUT')), timeoutMs);
            })]); } finally { clearTimeout(timer); }
        }
    };
}
function grantsAreScoped(rows, database) {
    if (!Array.isArray(rows) || rows.length < 2) return false;
    const expected = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
    let usage = false, scoped = false;
    for (const row of rows) {
        const values = Object.values(row);
        if (values.length !== 1 || typeof values[0] !== 'string') return false;
        const m = /^GRANT (.+) ON (.+) TO `kc_fault_harness`@`%`$/.exec(values[0]);
        if (!m) return false;
        if (m[1] === 'USAGE' && m[2] === '*.*' && !usage) { usage = true; continue; }
        const privileges = m[1].split(', ');
        if (m[2] !== `\`${database.replaceAll('_', '\\_')}\`.*` || scoped || privileges.length !== expected.size
            || new Set(privileges).size !== expected.size || privileges.some(p => !expected.has(p))) return false;
        scoped = true;
    }
    return usage && scoped;
}
async function preflight(pool, target) {
    validateTarget(target);
    const [identity] = await pool.query('SELECT @@server_uuid AS server_uuid, @@version AS version, CURRENT_USER() AS current_user, DATABASE() AS db, @@partial_revokes AS partial_revokes, CURRENT_ROLE() AS current_role');
    const actual = identity[0];
    requireThat(identity.length === 1 && actual.server_uuid === target.serverUuid
        && /^8\.4\.\d+(?:[-+].*)?$/.test(actual.version)
        && typeof actual.current_user === 'string' && actual.current_user === `${USER}@%`
        && actual.db === target.database && Number(actual.partial_revokes) === 0 && actual.current_role === 'NONE', 'LAB_SERVER_IDENTITY_MISMATCH');
    const [grants] = await pool.query('SHOW GRANTS');
    requireThat(grantsAreScoped(grants, target.database), 'LAB_PRIVILEGES_NOT_ISOLATED');
    const [tables] = await pool.query('SELECT TABLE_NAME AS name, ENGINE AS engine, TABLE_COLLATION AS collation FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?', [target.database]);
    requireThat(tables.length === TABLES.length && tables.map(t => t.name).sort().join(',') === TABLES.join(',')
        && tables.every(t => t.engine === 'InnoDB' && t.collation === 'utf8mb4_unicode_ci'), 'LAB_SCHEMA_MISMATCH');
    const [markers] = await pool.query('SELECT run_id, purpose FROM lab_identity');
    requireThat(markers.length === 1 && markers[0].run_id === target.runId && markers[0].purpose === PURPOSE, 'LAB_MARKER_MISMATCH');
    for (const table of TABLES.filter(t => t !== 'lab_identity')) {
        const [rows] = await pool.query(`SELECT COUNT(*) AS count FROM ${table}`);
        requireThat(rows.length === 1 && Number(rows[0].count) === 0, 'LAB_NOT_EMPTY');
    }
    return { status: 'PASS', serverUuid: target.serverUuid, version: actual.version, database: target.database };
}
async function expectError(action, code) {
    let caught;
    try { await action(); } catch (error) { caught = error; }
    requireThat(caught && (!code || caught.code === code), 'LAB_EXPECTED_ERROR_MISSING');
    return caught;
}
async function runCases(cases, beforeEach) {
    const results = cases.map(item => ({ id: item.id, status: 'NOT RUN' }));
    for (let i = 0; i < cases.length; i++) {
        try { await beforeEach(); await cases[i].run(); results[i].status = 'PASS'; }
        catch (error) { results[i] = { id: cases[i].id, status: 'FAIL', error: errorCode(error) }; break; }
    }
    return results;
}
function buildCases(pool, target) {
    const store = loadStore(pool, target);
    const owner = 'payment_LabOwnerA';
    const query = async (sql, params = []) => (await pool.query(sql, params))[0];
    const seed = async () => {
        const result = await query("INSERT INTO card_assets (card_number, card_expiry, card_cvc, card_holder) VALUES ('SYNTHETIC-NOT-A-CARD', '', '', 'LAB')");
        return Number(result.insertId);
    };
    const task = async ({ job = 'LabOwnerA', status = 'failed', payment = 'not_started', recovery = 0 } = {}) => {
        await query(`INSERT INTO task_logs (job_key, token_preview, execution_mode, status, payment_state, recovery_required, display_time)
            VALUES (?, 'SYNTHETIC', 'local_card_pool', ?, ?, ?, 'LAB')`, [job, status, payment, recovery]);
    };
    const state = async id => (await query('SELECT id, status, in_use, locked_by FROM card_assets WHERE id = ?', [id]))[0];
    const checkHeld = async (id, status = '支付处理中', expectedOwner = owner) => {
        const row = await state(id);
        requireThat(row && row.status === status && Number(row.in_use) === 1 && row.locked_by === expectedOwner, 'LAB_HOLD_INVARIANT');
    };
    const clean = async () => {
        await store.releaseStaleAssetLocks();
        await store.resetAllAssetLocks();
        await store.releaseCardsByOwner('LabOwnerA');
    };
    const makeStale = id => query('UPDATE card_assets SET locked_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE id = ?', [id]);
    const retryUntil = async check => {
        for (let i = 0; i < 30; i++) {
            if (await check()) return;
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        throw new LabError('LAB_ROLLBACK_NOT_OBSERVED');
    };
    const cases = [
        ['exact_owner_and_single_hold', async () => {
            const id = await seed(); await store.reserveCard(owner);
            for (const wrong of ['payment_labownera', `${owner} `, 'payment_Other']) {
                await expectError(() => store.markCardPaymentStarted(id, wrong), 'CARD_LOCK_OWNERSHIP_LOST');
                requireThat(await store.releaseCard(id, wrong) === 0, 'LAB_WRONG_OWNER_RELEASED');
            }
            await store.markCardPaymentStarted(id, owner);
            await expectError(() => store.markCardPaymentStarted(id, owner), 'CARD_LOCK_OWNERSHIP_LOST');
            for (const wrong of ['payment_labownera', `${owner} `, 'payment_Other']) {
                await expectError(() => store.completeCardPayment(id, wrong), 'CARD_LOCK_OWNERSHIP_LOST');
            }
            await checkHeld(id);
            await store.completeCardPayment(id, owner);
            await expectError(() => store.completeCardPayment(id, owner), 'CARD_LOCK_OWNERSHIP_LOST');
            requireThat(Number((await state(id)).in_use) === 0, 'LAB_COMPLETE_DID_NOT_RELEASE');
        }],
        ['concurrent_reserve', async () => {
            const id = await seed();
            const results = await Promise.all([store.reserveCard(owner), store.reserveCard('payment_Other')]);
            requireThat(results.filter(Boolean).length === 1 && results.find(Boolean).id === id, 'LAB_DOUBLE_RESERVATION');
        }],
        ['pending_hold_cleanup', async () => {
            const id = await seed(); await task(); await store.reserveCard(owner);
            await store.markCardPaymentStarted(id, owner); await makeStale(id);
            await clean(); requireThat(await store.releaseCard(id, owner) === 0, 'LAB_HOLD_RELEASED');
            await checkHeld(id); requireThat(await store.reserveCard('payment_Other') === null, 'LAB_HOLD_REUSED');
        }],
        ['unsafe_task_cleanup', async () => {
            const samples = [
                { status: 'running' }, { payment: 'unknown' }, { recovery: 1 },
                { job: 'labownera' }, { job: 'LabOwnerA ' }, { missing: true }, { debug: true }
            ];
            for (const sample of samples) {
                const id = await seed();
                if (!sample.missing) await task({ ...sample, job: sample.debug ? 'UnrelatedDebugTask' : sample.job });
                const lockOwner = sample.debug ? `payment_debug_${id}` : owner;
                await query("UPDATE card_assets SET in_use = 1, locked_by = ?, locked_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE id = ?", [lockOwner, id]);
                await clean(); await checkHeld(id, '正常', lockOwner);
                await query('DELETE FROM task_logs');
            }
        }],
        ['confirmed_no_charge_cleanup', async () => {
            for (const status of ['failed', 'cancelled']) for (const payment of ['not_started', 'declined']) {
                const id = await seed(); await task({ status, payment });
                // Reserve the new row explicitly: prior positive controls remain idle.
                await query('UPDATE card_assets SET is_active = 0 WHERE id <> ?', [id]);
                await store.reserveCard(owner); await makeStale(id);
                const released = await store.releaseStaleAssetLocks();
                requireThat(released.cardReleased === 1 && Number((await state(id)).in_use) === 0, 'LAB_SAFE_LOCK_NOT_RECLAIMED');
                await query('DELETE FROM task_logs');
            }
        }],
        ['hold_cleanup_race', async () => {
            for (let i = 0; i < 12; i++) {
                const id = await seed(); await task(); await store.reserveCard(owner); await makeStale(id);
                let submissions = 0;
                const [gate, cleanup] = await Promise.allSettled([
                    store.markCardPaymentStarted(id, owner).then(() => { submissions++; }),
                    store.releaseStaleAssetLocks()
                ]);
                requireThat(cleanup.status === 'fulfilled', 'LAB_RACE_CLEANUP_FAILED');
                if (gate.status === 'fulfilled') { requireThat(submissions === 1, 'LAB_SUBMISSION_COUNT'); await checkHeld(id); }
                else {
                    requireThat(gate.reason.code === 'CARD_LOCK_OWNERSHIP_LOST' && submissions === 0, 'LAB_RACE_OPENED_GATE');
                    requireThat(Number((await state(id)).in_use) === 0, 'LAB_RACE_UNKNOWN_STATE');
                }
                await query('DELETE FROM card_assets'); await query('DELETE FROM task_logs');
            }
        }],
        ['database_deadlock', async () => {
            const a = await seed(), b = await seed();
            const first = await pool.getConnection(); let second;
            try {
                second = await pool.getConnection();
                await first.beginTransaction(); await second.beginTransaction();
                await first.query('UPDATE card_assets SET usage_count = usage_count + 1 WHERE id = ?', [a]);
                await second.query('UPDATE card_assets SET usage_count = usage_count + 1 WHERE id = ?', [b]);
                const results = await Promise.allSettled([
                    first.query('UPDATE card_assets SET usage_count = usage_count + 1 WHERE id = ?', [b]),
                    second.query('UPDATE card_assets SET usage_count = usage_count + 1 WHERE id = ?', [a])
                ]);
                requireThat(results.filter(r => r.status === 'rejected' && r.reason.code === 'ER_LOCK_DEADLOCK').length === 1
                    && results.filter(r => r.status === 'fulfilled').length === 1, 'LAB_DEADLOCK_NOT_OBSERVED');
            } finally {
                await Promise.allSettled([first, second].filter(Boolean).map(async c => {
                    try { await c.rollback(); } finally { c.destroy(); }
                }));
            }
        }],
        ['disconnect_uncommitted', async () => {
            const id = await seed(); const c = await pool.getConnection();
            try {
                await c.beginTransaction();
                await c.query('UPDATE card_assets SET in_use = 1, locked_by = ? WHERE id = ?', [owner, id]);
            } finally { c.destroy(); }
            await retryUntil(async () => Number((await state(id)).in_use) === 0);
            requireThat((await store.reserveCard('payment_Other'))?.id === id, 'LAB_ROLLBACK_NOT_REUSABLE');
        }],
        ['disconnect_before_commit', async () => {
            const id = await seed(); const original = new LabError('LAB_BEFORE_COMMIT_DISCONNECT');
            const faulty = loadStore(transactionFaultPool(pool, 'before_send', original), target);
            requireThat(await expectError(() => faulty.reserveCard(owner)) === original, 'LAB_ORIGINAL_ERROR_LOST');
            await retryUntil(async () => Number((await state(id)).in_use) === 0);
            requireThat((await store.reserveCard('payment_Other'))?.id === id, 'LAB_ROLLBACK_NOT_REUSABLE');
        }],
        ['discard_commit_ack', async () => {
            const id = await seed(); const original = new LabError('LAB_COMMIT_RESPONSE_DISCARDED');
            const faulty = loadStore(transactionFaultPool(pool, 'after_ack', original), target);
            requireThat(await expectError(() => faulty.reserveCard(owner)) === original, 'LAB_ORIGINAL_ERROR_LOST');
            await checkHeld(id, '正常'); await clean(); await checkHeld(id, '正常');
            requireThat(await store.reserveCard('payment_Other') === null, 'LAB_UNCERTAIN_COMMIT_REUSED');
        }],
        ['discard_hold_ack', async () => {
            const id = await seed(); await store.reserveCard(owner);
            const faulty = loadStore(autocommitFaultPool(pool), target);
            const error = await expectError(() => faulty.markCardPaymentStarted(id, owner));
            requireThat(error.message.endsWith('LAB_WRITE_RESPONSE_DISCARDED'), 'LAB_FAULT_NOT_OBSERVED');
            await clean(); await checkHeld(id);
            requireThat(await store.reserveCard('payment_Other') === null, 'LAB_UNCERTAIN_HOLD_REUSED');
        }],
        ['reload_store_preserves_hold', async () => {
            const id = await seed(); await store.reserveCard(owner); await store.markCardPaymentStarted(id, owner);
            const reloaded = loadStore(pool, target);
            await reloaded.resetAllAssetLocks(); await checkHeld(id);
            requireThat(await reloaded.reserveCard('payment_Other') === null, 'LAB_RELOAD_REUSED_HOLD');
        }]
    ].map(([id, run]) => ({ id, run }));
    requireThat(cases.map(c => c.id).join(',') === SCENARIOS.join(','), 'LAB_PLAN_CASE_MISMATCH');
    return { cases, async beforeEach() {
        // DML only after read-only preflight; preserve a failing case by stopping immediately.
        for (const table of TABLES.filter(t => t !== 'lab_identity')) await query(`DELETE FROM ${table}`);
    } };
}
async function runLab(pool, target) {
    const before = sourceHashes();
    const report = { mode: 'EXECUTE', status: 'FAIL', sourceBefore: before,
        preflight: { status: 'NOT RUN' }, scenarios: SCENARIOS.map(id => ({ id, status: 'NOT RUN' })),
        manualScenarios: MANUAL.map(id => ({ id, status: 'NOT RUN' })) };
    try {
        report.preflight = await preflight(pool, target);
        const { cases, beforeEach } = buildCases(pool, target);
        report.scenarios = await runCases(cases, async () => {
            requireThat(JSON.stringify(sourceHashes()) === JSON.stringify(before), 'LAB_SOURCE_CHANGED');
            await beforeEach();
        });
        if (report.scenarios.every(c => c.status === 'PASS')) report.status = 'PASS';
    } catch (error) {
        if (report.preflight.status === 'NOT RUN') report.preflight.status = 'FAIL';
        report.error = errorCode(error);
    }
    report.sourceAfter = sourceHashes();
    if (JSON.stringify(before) !== JSON.stringify(report.sourceAfter)) {
        report.status = 'REVIEW'; report.error = 'LAB_SOURCE_CHANGED';
    }
    // PASS means only the listed automated lab cases, never the manual scenarios.
    return report;
}
module.exports = { poolOptions, boundedPool, grantsAreScoped, preflight, expectError, runCases, buildCases, runLab };
