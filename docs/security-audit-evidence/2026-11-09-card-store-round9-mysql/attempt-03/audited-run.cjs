'use strict';
// Authorized, isolated real-MySQL experiment. Not a production runner.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const tls = require('node:tls');
const dgram = require('node:dgram');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');
const E = __dirname;
const context = JSON.parse(fs.readFileSync(path.join(E, 'context.json'), 'utf8'));
const base = path.join(context.root, 'services/kc-pay-gpt/acceptance/mysql-payment-hold');
const targetFile = path.join(E, 'target.json');
const { readTarget, validateEnvironment, LabError } = require(path.join(base, 'safety.cjs'));
validateEnvironment(process.env);
const target = readTarget(targetFile);
assert.equal(target.runId, context.runId);
const fail = code => { throw new LabError(code); };
// API-level boundary, not an OS sandbox. Only the recorded loopback endpoint.
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
    const arg = args[0];
    const opts = Array.isArray(arg) ? arg[0] : arg;
    const port = typeof opts === 'object' ? opts.port : opts;
    const host = typeof opts === 'object' ? opts.host : args[1];
    if (Number(port) !== target.port || host !== target.host) fail('LAB_AUDIT_NETWORK_REJECTED');
    return connect.apply(this, args);
};
net.Server.prototype.listen = () => fail('LAB_AUDIT_LISTEN_REJECTED');
tls.connect = () => fail('LAB_AUDIT_TLS_REJECTED');
dgram.createSocket = () => fail('LAB_AUDIT_UDP_REJECTED');
for (const key of ['readFileSync', 'readFile', 'openSync', 'open', 'createReadStream']) {
    const original = fs[key];
    fs[key] = function (file, ...args) {
        if (typeof file !== 'number' && /(^|[\\/])\.env(?:$|\.)/.test(String(file))) fail('LAB_AUDIT_ENV_READ_REJECTED');
        return original.call(this, file, ...args);
    };
}
const fd = fs.openSync(path.join(E, 'sql/executed-statements-01.sql'), 'wx', 0o600);
const events = [];
const tables = new Set(['card_assets', 'phone_assets', 'pool_emails', 'task_logs']);
function record(args, method) {
    const sql = typeof args[0] === 'string' ? args[0] : args[0]?.sql;
    if (typeof sql !== 'string' || /;|\b(?:OUTFILE|DUMPFILE|LOAD_FILE|SLEEP|BENCHMARK)\b/i.test(sql)) fail('LAB_AUDIT_SQL_REJECTED');
    const compact = sql.replace(/\s+/g, ' ').trim();
    const write = /^(?:INSERT INTO|UPDATE|DELETE FROM) ([a-z_]+)\b/.exec(compact);
    if (write ? !tables.has(write[1]) : !(/^(?:SELECT |SHOW GRANTS$|SET SESSION innodb_lock_wait_timeout = 2$|START TRANSACTION$|COMMIT$|ROLLBACK$)/.test(compact))) fail('LAB_AUDIT_SQL_REJECTED');
    const event = { sequence: events.length + 1, method, verb: compact.split(' ')[0], status: 'SENT' };
    events.push(event);
    // Persist before sending. Never record parameters or result rows.
    fs.writeSync(fd, `-- Statement ${event.sequence}; parameters intentionally omitted\n${sql};\n\n`);
    fs.fsyncSync(fd);
    return event;
}
const runtimeRequire = createRequire(path.join(context.root, 'services/kc-pay-gpt/mysql-store.js'));
const mysql = runtimeRequire('mysql2/promise');
const createPool = mysql.createPool.bind(mysql);
const { poolOptions } = require(path.join(base, 'lab.cjs'));
let pools = 0;
mysql.createPool = options => {
    assert.deepEqual(options, poolOptions(target));
    if (++pools !== 1) fail('LAB_AUDIT_EXTRA_POOL');
    const raw = createPool(options);
    return {
        async getConnection() {
            const c = await raw.getConnection();
            const call = async (method, args) => {
                const event = record(args, method);
                try { const result = await c[method](...args); event.status = 'ACK'; return result; }
                catch (error) { event.status = 'ERROR'; event.code = /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'UNCLASSIFIED'; throw error; }
            };
            return { query: (...args) => call('query', args), execute: (...args) => call('execute', args),
                destroy: () => c.destroy(), release: () => c.release() };
        },
        end: () => raw.end()
    };
};
const { main } = require(path.join(base, 'cli.cjs'));
main(['--execute', '--config', targetFile, '--ack', 'isolated-synthetic-mysql-only'])
    .then(code => { process.exitCode = code; })
    .catch(() => { process.stdout.write('{"status":"FAIL","error":"LAB_AUDITED_RUN_FAILED"}\n'); process.exitCode = 1; })
    .finally(() => {
        fs.closeSync(fd);
        fs.writeFileSync(path.join(E, 'sql-events-01.json'), `${JSON.stringify({ pools, events }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    });
