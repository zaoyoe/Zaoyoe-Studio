'use strict';
const { parseArgs, validateEnvironment, readTarget, errorCode } = require('./safety.cjs');
const { makePlan } = require('./plan.cjs');
async function main(args = process.argv.slice(2), env = process.env, write = value => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)) {
    let pool;
    try {
        const command = parseArgs(args);
        if (command.mode === 'plan') { write(makePlan(command.runId)); return 0; }
        validateEnvironment(env);
        const target = readTarget(command.filename);
        const { poolOptions, boundedPool, runLab } = require('./lab.cjs');
        // No dotenv, service bootstrap, driver import or connection on the plan path.
        const mysql = require('mysql2/promise');
        pool = boundedPool(mysql.createPool(poolOptions(target)));
        const report = await runLab(pool, target);
        write(report);
        return report.status === 'PASS' ? 0 : 1;
    } catch (error) { write({ status: 'FAIL', error: errorCode(error) }); return 1; }
    finally { if (pool) { try { await pool.end(); } catch (_) { /* no raw driver output */ } } }
}
if (require.main === module) main().then(code => { process.exitCode = code; });
module.exports = { main };
