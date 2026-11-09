'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const base = path.join(root, 'services/kc-pay-gpt/acceptance/mysql-payment-hold');
const guard = path.join(root, 'docs/security-audit-evidence/2026-11-09-card-store-round8/isolation/preload.cjs');
const safety = require(path.join(base, 'safety.cjs'));
const { makePlan, SCENARIOS, MANUAL, sourceHashes } = require(path.join(base, 'plan.cjs'));
const { poolOptions, boundedPool, grantsAreScoped, preflight, runCases, runLab, buildCases } = require(path.join(base, 'lab.cjs'));
const { loadStore, transactionFaultPool, autocommitFaultPool } = require(path.join(base, 'store-loader.cjs'));
const { main } = require(path.join(base, 'cli.cjs'));
const runId = '0123456789abcdef';
const target = () => ({ runId, host: '127.0.0.1', port: 23316, database: `kc_fault_lab_${runId}`,
    user: safety.USER, serverUuid: '12345678-1234-1234-1234-123456789abc' });
const failCode = code => error => error.code === code;
function temp(t) {
    const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'kc-offline-lab-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}
function config(t, content = JSON.stringify(target()), mode = 0o600) {
    const file = path.join(temp(t), 'target.json');
    fs.writeFileSync(file, content, { mode });
    return file;
}
function child(code, args = []) {
    return spawnSync(process.execPath, ['--require', guard, '-e', code, ...args], {
        cwd: root, env: { PATH: process.env.PATH, CI: '1', NO_COLOR: '1' }, encoding: 'utf8', timeout: 10000
    });
}
function scopedGrants(database = target().database) {
    return [
        { Grants: 'GRANT USAGE ON *.* TO `kc_fault_harness`@`%`' },
        { Grants: `GRANT SELECT, INSERT, UPDATE, DELETE ON \`${database.replaceAll('_', '\\_')}\`.* TO \`kc_fault_harness\`@\`%\`` }
    ];
}
// SQL strings are inspected by spies only. No driver or database is used.
function fakePreflight(change = {}) {
    const seen = [];
    const pool = { async query(sql) {
        seen.push(sql);
        if (sql.startsWith('SELECT @@server_uuid')) return [[{
            server_uuid: target().serverUuid, version: '8.4.7', current_user: 'kc_fault_harness@%',
            db: target().database, partial_revokes: 0, current_role: 'NONE', ...change.identity
        }]];
        if (sql === 'SHOW GRANTS') return [change.grants || scopedGrants()];
        if (sql.includes('information_schema.TABLES')) return [change.tables || safety.TABLES.map(name => ({ name, engine: 'InnoDB', collation: 'utf8mb4_unicode_ci' }))];
        if (sql === 'SELECT run_id, purpose FROM lab_identity') return [change.markers || [{ run_id: runId, purpose: safety.PURPOSE }]];
        if (sql.startsWith('SELECT COUNT(*)')) return [[{ count: change.count || 0 }]];
        throw new Error('UNEXPECTED_SQL_IN_OFFLINE_SPY');
    } };
    return { pool, seen };
}

test('valid target is fixed, copied and frozen', () => {
    const input = target(), checked = safety.validateTarget(input);
    assert.notEqual(checked, input); assert.ok(Object.isFrozen(checked));
    assert.deepEqual(checked, input);
});
for (const [key, value] of Object.entries({ host: 'localhost', port: 3311, database: 'gpt', user: 'root',
    runId: '../production', serverUuid: 'REPLACE_WITH_DISPOSABLE_SERVER_UUID' })) {
    test(`reject target substitution: ${key}`, () => assert.throws(() => safety.validateTarget({ ...target(), [key]: value })));
}
for (const value of [null, [], Object.create(null), { ...target(), password: 'anything' },
    { ...target(), uri: 'mysql://production' }, { ...target(), socketPath: '/tmp/mysql.sock' }]) {
    test(`reject target shape ${JSON.stringify(value)}`, () => assert.throws(() => safety.validateTarget(value)));
}
test('default and explicit plan never imply execution', () => {
    assert.deepEqual(safety.parseArgs([]), { mode: 'plan' });
    assert.equal(safety.parseArgs(['--plan']).mode, 'plan');
    assert.equal(safety.parseArgs(['--plan', '--run-id', runId]).runId, runId);
    assert.equal(safety.parseArgs(['--execute', '--config', '/synthetic/target.json', '--ack', safety.ACK]).mode, 'execute');
});
for (const args of [ ['--execute'], ['--plan', '--execute'], ['--plan', '--plan'], ['--wat'],
    ['--config', '/x.json'], ['--plan', '--config', '/x.json'], ['--plan', '--run-id'],
    ['--execute', '--config', '/x.json', '--ack', 'yes'],
    ['--execute', '--config', '/x.json', '--ack', safety.ACK, '--run-id', runId] ]) {
    test(`reject unsafe CLI args ${args.join(' ')}`, () => assert.throws(() => safety.parseArgs(args)));
}
for (const key of ['DB_HOST', 'mysql_pwd', 'MARIADB_USER', 'KC_SESSION_ENCRYPTION_KEY', 'GUEST_SHOP_KEY',
    'SUPABASE_URL', 'STRIPE_SECRET', 'PAYMENT_KEY', 'PROXY_URL', 'ALL_PROXY', 'https_proxy', 'DATABASE_URL', 'NODE_OPTIONS', 'NODE_PATH']) {
    test(`reject ambient environment ${key}`, () => assert.throws(() => safety.validateEnvironment({ [key]: '' }), failCode('LAB_AMBIENT_ENV_REJECTED')));
}
test('minimal environment permitted', () => assert.doesNotThrow(() => safety.validateEnvironment({ PATH: '/synthetic', CI: '1' })));
test('read an explicit private regular JSON config', t => assert.deepEqual(safety.readTarget(config(t)), target()));
for (const [label, content, mode] of [ ['public', JSON.stringify(target()), 0o644], ['empty', '', 0o600],
    ['oversize', ' '.repeat(4097), 0o600], ['invalid JSON', '{"secret":"synthetic-private"', 0o600],
    ['extra key', JSON.stringify({ ...target(), password: 'synthetic-private' }), 0o600] ]) {
    test(`reject config file ${label}`, t => assert.throws(() => safety.readTarget(config(t, content, mode))));
}
test('reject config symlink before opening its destination', t => {
    const original = config(t), alias = path.join(temp(t), 'alias.json');
    fs.symlinkSync(original, alias);
    assert.throws(() => safety.readTarget(alias), failCode('LAB_TARGET_FILE_SYMLINK'));
});
test('reject relative, env and directory config paths', t => {
    for (const filename of ['target.json', '/synthetic/.env/target.json', '/synthetic/.env.local', temp(t)]) {
        assert.throws(() => safety.readTarget(filename));
    }
});
test('default plan is deterministic with supplied ID and leaves all runtime cases NOT RUN', () => {
    const plan = makePlan(runId);
    assert.equal(plan.mode, 'PLAN_ONLY'); assert.equal(plan.connected, false); assert.equal(plan.sqlExecuted, false);
    assert.deepEqual(plan, makePlan(runId)); assert.deepEqual(plan.sourceHashes, sourceHashes());
    assert.deepEqual(plan.scenarios.map(c => c.id), SCENARIOS);
    assert.equal(plan.scenarios.length, 12); assert.equal(plan.manualScenarios.length, 3);
    assert.ok([...plan.scenarios, ...plan.manualScenarios].every(c => c.status === 'NOT RUN'));
    assert.throws(() => safety.validateTarget(plan.targetTemplate));
    assert.doesNotMatch(plan.fixtureSql, /__(?:DATABASE|GRANT_DATABASE|RUN_ID)__/);
    assert.ok(plan.fixtureSql.includes(`ON \`${target().database.replaceAll('_', '\\_')}\`.*`));
    assert.doesNotMatch(plan.fixtureSql, /\b(?:DROP|TRUNCATE)\s+(?:DATABASE|TABLE)/i);
});
test('fixture uses the four current card-lock table definitions', () => {
    const schema = fs.readFileSync(path.join(base, '../../mysql-schema.sql'), 'utf8');
    const fixture = fs.readFileSync(path.join(base, 'fixture.sql'), 'utf8');
    for (const table of safety.TABLES.filter(t => t !== 'lab_identity')) {
        const re = new RegExp(`CREATE TABLE(?: IF NOT EXISTS)? ${table} \\([\\s\\S]*?\\) ENGINE=InnoDB[^;]+;`);
        const original = schema.match(re)?.[0]?.replace(' IF NOT EXISTS', '');
        assert.ok(original, table); assert.equal(fixture.match(re)?.[0], original, table);
    }
    assert.match(fixture, /ADD COLUMN gpt_api_order_id VARCHAR\(128\) NULL/);
    assert.match(fixture, /ADD COLUMN gpt_api_task_id VARCHAR\(128\) NULL/);
    assert.match(fixture, /ADD COLUMN gpt_api_raw MEDIUMTEXT NULL/);
});
test('CLI default plan never imports driver, dotenv or server', () => {
    const out = child(`const Module=require('node:module');const original=Module._load;Module._load=function(id,...rest){if(/mysql2|dotenv|server\\.js/.test(id))throw Error('FORBIDDEN_IMPORT');return original.call(this,id,...rest)};require(${JSON.stringify(path.join(base, 'cli.cjs'))}).main([], {DB_HOST:'must-be-ignored-for-plan'}).then(code=>process.exitCode=code);`);
    assert.equal(out.status, 0, out.stderr); assert.equal(JSON.parse(out.stdout).mode, 'PLAN_ONLY');
});
test('CLI refuses polluted execute before reading config or loading driver', async () => {
    const reports = [];
    const exit = await main(['--execute', '--config', '/nonexistent/target.json', '--ack', safety.ACK],
        { DB_HOST: 'synthetic-private' }, report => reports.push(report));
    assert.equal(exit, 1); assert.deepEqual(reports, [{ status: 'FAIL', error: 'LAB_AMBIENT_ENV_REJECTED' }]);
});
test('CLI failure output never emits invalid JSON content or stack', async t => {
    const reports = [];
    assert.equal(await main(['--execute', '--config', config(t, 'synthetic-private-invalid-json'), '--ack', safety.ACK], {}, r => reports.push(r)), 1);
    assert.deepEqual(reports, [{ status: 'FAIL', error: 'LAB_CASE_FAILED' }]);
});
test('safe error serialization drops raw message and SQL', () => {
    assert.equal(safety.errorCode({ message: 'synthetic-private', sql: 'private' }), 'LAB_CASE_FAILED');
    assert.equal(safety.errorCode({ code: 'private-error' }), 'LAB_CASE_FAILED');
    assert.equal(safety.errorCode({ code: 'ER_LOCK_DEADLOCK' }), 'ER_LOCK_DEADLOCK');
});
test('pool options fix the synthetic target and disable multi-statement/local files', () => {
    const opts = poolOptions(target());
    assert.equal(opts.port, 23316); assert.equal(opts.password, safety.PASSWORD);
    assert.equal(opts.multipleStatements, false); assert.ok(opts.flags.includes('-LOCAL_FILES'));
    assert.equal(opts.connectionLimit, 4); assert.ok(opts.queueLimit > 0);
});
test('grants allow only literal database DML and USAGE', () => {
    assert.equal(grantsAreScoped(scopedGrants(), target().database), true);
    assert.equal(grantsAreScoped(scopedGrants().reverse(), target().database), true);
    const baseRows = scopedGrants();
    for (const replacement of [
        baseRows[1].Grants.replaceAll('\\_', '_'),
        baseRows[1].Grants.replace('SELECT, INSERT, UPDATE, DELETE', 'ALL PRIVILEGES'),
        baseRows[1].Grants + ' WITH GRANT OPTION',
        baseRows[1].Grants.replace('kc\\_fault\\_lab', 'production'),
        baseRows[1].Grants.replace('@`%`', '@`localhost`')
    ]) assert.equal(grantsAreScoped([baseRows[0], { Grants: replacement }], target().database), false);
    assert.equal(grantsAreScoped([...baseRows, { Grants: 'GRANT `admin_role`@`%` TO `kc_fault_harness`@`%`' }], target().database), false);
    assert.equal(grantsAreScoped([...baseRows, baseRows[1]], target().database), false);
    assert.equal(grantsAreScoped(baseRows.slice(0, 1), target().database), false);
});
test('preflight accepts synthetic identity and only issues SELECT/SHOW', async () => {
    const { pool, seen } = fakePreflight();
    assert.equal((await preflight(pool, target())).status, 'PASS');
    assert.ok(seen.every(sql => /^(SELECT|SHOW) /.test(sql)));
    assert.ok(seen.includes('SHOW GRANTS'));
});
for (const [label, change, expected] of [
    ['UUID', { identity: { server_uuid: 'other' } }, 'LAB_SERVER_IDENTITY_MISMATCH'],
    ['version', { identity: { version: '8.0.40' } }, 'LAB_SERVER_IDENTITY_MISMATCH'],
    ['account', { identity: { current_user: 'root@localhost' } }, 'LAB_SERVER_IDENTITY_MISMATCH'],
    ['database', { identity: { db: 'gpt' } }, 'LAB_SERVER_IDENTITY_MISMATCH'],
    ['partial revokes', { identity: { partial_revokes: 1 } }, 'LAB_SERVER_IDENTITY_MISMATCH'],
    ['active role', { identity: { current_role: '`admin`@`%`' } }, 'LAB_SERVER_IDENTITY_MISMATCH'],
    ['global privileges', { grants: [{ Grants: 'GRANT ALL PRIVILEGES ON *.* TO `kc_fault_harness`@`%`' }] }, 'LAB_PRIVILEGES_NOT_ISOLATED'],
    ['table set', { tables: [] }, 'LAB_SCHEMA_MISMATCH'],
    ['marker', { markers: [{ run_id: 'other', purpose: safety.PURPOSE }] }, 'LAB_MARKER_MISMATCH'],
    ['nonempty', { count: 1 }, 'LAB_NOT_EMPTY']
]) {
    test(`preflight rejects ${label} without DML`, async () => {
        const { pool, seen } = fakePreflight(change);
        await assert.rejects(() => preflight(pool, target()), failCode(expected));
        assert.ok(seen.every(sql => /^(SELECT|SHOW) /.test(sql)));
    });
}
test('preflight failure is FAIL, with all cases NOT RUN', async () => {
    const { pool, seen } = fakePreflight({ count: 1 });
    const report = await runLab(pool, target());
    assert.equal(report.status, 'FAIL'); assert.equal(report.preflight.status, 'FAIL');
    assert.equal(report.error, 'LAB_NOT_EMPTY');
    assert.ok([...report.scenarios, ...report.manualScenarios].every(c => c.status === 'NOT RUN'));
    assert.ok(seen.every(sql => /^(SELECT|SHOW) /.test(sql)));
});
test('stop after first failed case; do not erase failure scene or run later cleanup', async () => {
    const seen = []; let cleanups = 0;
    const cases = ['one', 'two', 'three'].map(id => ({ id, async run() {
        seen.push(id); if (id === 'two') throw { code: 'ER_LOCK_DEADLOCK', message: 'synthetic-private' };
    } }));
    const results = await runCases(cases, async () => { cleanups++; });
    assert.deepEqual(seen, ['one', 'two']); assert.equal(cleanups, 2);
    assert.deepEqual(results.map(c => c.status), ['PASS', 'FAIL', 'NOT RUN']);
    assert.equal(results[1].error, 'ER_LOCK_DEADLOCK'); assert.doesNotMatch(JSON.stringify(results), /synthetic-private/);
});
test('cleanup failure also stops before running that case', async () => {
    let ran = false;
    const results = await runCases([{ id: 'one', async run() { ran = true; } }, { id: 'two' }], async () => { throw Error('private'); });
    assert.equal(ran, false); assert.deepEqual(results.map(c => c.status), ['FAIL', 'NOT RUN']);
});
test('case construction loads store without SQL or bootstrap', () => {
    const deny = () => { throw Error('unexpected pool use'); };
    const { cases } = buildCases({ query: deny, execute: deny, getConnection: deny }, target());
    assert.deepEqual(cases.map(c => c.id), SCENARIOS);
});
for (const phase of ['before_send', 'after_ack']) {
    test(`real store preserves original ${phase} fault when rollback also fails`, async () => {
        const seen = [], original = new safety.LabError('LAB_SYNTHETIC_FAULT');
        const c = {
            async beginTransaction() { seen.push('begin'); },
            async query(sql) { seen.push(sql.trim().startsWith('SELECT') ? 'select' : 'update'); return sql.trim().startsWith('SELECT') ? [[{ id: 1, usage_count: 0 }]] : [{ affectedRows: 1 }]; },
            async commit() { seen.push('commit'); }, destroy() { seen.push('destroy'); }
        };
        const store = loadStore(transactionFaultPool({ async getConnection() { return c; } }, phase, original), target());
        await assert.rejects(() => store.reserveCard('payment_LabOwnerA'), error => error === original);
        assert.deepEqual(seen.slice(0, 3), ['begin', 'select', 'update']);
        assert.equal(seen.includes('commit'), phase === 'after_ack');
        assert.ok(seen.includes('destroy'));
    });
}
test('successful hold response can be discarded after one write without an unlock', async () => {
    let writes = 0, destroyed = 0;
    const store = loadStore(autocommitFaultPool({ async getConnection() { return {
        async execute(sql) { writes++; assert.match(sql, /支付处理中/); return [{ affectedRows: 1 }]; },
        destroy() { destroyed++; }
    }; } }), target());
    await assert.rejects(() => store.markCardPaymentStarted(1, 'payment_LabOwnerA'), error => error.message.endsWith('LAB_WRITE_RESPONSE_DISCARDED'));
    assert.equal(writes, 1); assert.ok(destroyed >= 1);
});
test('real store rejects lost hold ownership, then accepts exactly one affected row', async () => {
    let changed = 0;
    const store = loadStore({ async execute() { return [{ affectedRows: changed }]; } }, target());
    await assert.rejects(() => store.markCardPaymentStarted(1, 'payment_LabOwnerA'), failCode('CARD_LOCK_OWNERSHIP_LOST'));
    changed = 1; await store.markCardPaymentStarted(1, 'payment_LabOwnerA');
    changed = 2; await assert.rejects(() => store.markCardPaymentStarted(1, 'payment_LabOwnerA'), failCode('CARD_LOCK_OWNERSHIP_LOST'));
});
test('bounded query timeout destroys instead of releasing the connection', async () => {
    let destroyed = 0, released = 0;
    const c = { async query({ sql }) { if (sql.startsWith('SET SESSION')) return [[]]; return new Promise(() => {}); },
        destroy() { destroyed++; }, release() { released++; } };
    const pool = boundedPool({ async getConnection() { return c; }, async end() {} }, 20);
    await assert.rejects(() => pool.query('SELECT synthetic'), failCode('LAB_QUERY_TIMEOUT'));
    assert.equal(destroyed, 1); assert.equal(released, 0); await pool.end();
});
test('late connection acquisition is destroyed after deadline', async () => {
    let resolve, destroyed = 0;
    const pending = new Promise(r => { resolve = r; });
    const pool = boundedPool({ getConnection() { return pending; }, async end() {} }, 20);
    await assert.rejects(() => pool.getConnection(), failCode('LAB_ACQUIRE_TIMEOUT'));
    resolve({ destroy() { destroyed++; } });
    await new Promise(r => setImmediate(r)); assert.equal(destroyed, 1); await pool.end();
});
for (const cleanupThrows of [false, true]) {
    test(`driver failure destroys connection and preserves original error; cleanupThrows=${cleanupThrows}`, async () => {
        const original = Object.assign(new Error('synthetic-driver-error'), { code: 'PROTOCOL_CONNECTION_LOST' });
        let destroyed = 0, released = 0;
        const c = {
            async query({ sql }) { if (sql.startsWith('SET SESSION')) return [[]]; throw original; },
            destroy() { destroyed++; if (cleanupThrows) throw new Error('synthetic-cleanup-error'); },
            release() { released++; }
        };
        const pool = boundedPool({ async getConnection() { return c; }, async end() {} });
        await assert.rejects(() => pool.query('SELECT synthetic'), error => error === original);
        assert.equal(destroyed, 1); assert.equal(released, 0); await pool.end();
    });
}
test('bounded connection normal flow sets session limits and releases once', async () => {
    const seen = [];
    const c = { async query({ sql }) { seen.push(sql); return [[]]; }, destroy() { seen.push('destroy'); }, release() { seen.push('release'); } };
    const pool = boundedPool({ async getConnection() { return c; }, async end() { seen.push('end'); } });
    const connection = await pool.getConnection();
    await connection.beginTransaction(); await connection.commit(); connection.release(); connection.release();
    await assert.rejects(() => connection.rollback(), failCode('LAB_CONNECTION_CLOSED'));
    await pool.end(); await assert.rejects(() => pool.getConnection(), failCode('LAB_POOL_CLOSED'));
    assert.deepEqual(seen, ['SET SESSION innodb_lock_wait_timeout = 2', 'START TRANSACTION', 'COMMIT', 'release', 'end']);
});
test('offline guard blocks network, listening and actual env-file reads before access', () => {
    const code = `const fs=require('node:fs'),net=require('node:net'),assert=require('node:assert/strict');for(const f of [()=>fs.readFileSync('/synthetic/.env'),()=>fs.openSync('/synthetic/.env.production','r'),()=>net.connect(23316,'127.0.0.1'),()=>net.createServer().listen(23316)])assert.throws(f,/TEST_(?:ENV_FILE_READ|NETWORK_CONNECT)_BLOCKED/);console.log('GUARD_PASS');`;
    const result = child(code); assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /GUARD_PASS/);
});
