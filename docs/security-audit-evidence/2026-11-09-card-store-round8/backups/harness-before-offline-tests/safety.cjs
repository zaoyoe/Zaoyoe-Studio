'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ACK = 'isolated-synthetic-mysql-only';
const USER = 'kc_fault_harness';
// Public synthetic credential, valid only in a disposable, loopback-only lab.
const PASSWORD = 'kc-fault-synthetic-local-only';
const PORT = 23316;
const PURPOSE = 'KC_PAYMENT_HOLD_DISPOSABLE_LAB_V1';
const TABLES = ['card_assets', 'lab_identity', 'phone_assets', 'pool_emails', 'task_logs'];
class LabError extends Error {
    constructor(code) { super(code); this.code = code; }
}
const requireThat = (condition, code) => { if (!condition) throw new LabError(code); };
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
function validateRunId(runId) {
    requireThat(typeof runId === 'string' && /^[a-f0-9]{16}$/.test(runId), 'LAB_INVALID_RUN_ID');
    return runId;
}
function validateTarget(value) {
    requireThat(value && Object.getPrototypeOf(value) === Object.prototype, 'LAB_INVALID_TARGET');
    const keys = ['runId', 'host', 'port', 'database', 'user', 'serverUuid'];
    requireThat(Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k)), 'LAB_TARGET_KEYS');
    validateRunId(value.runId);
    requireThat(value.host === '127.0.0.1' && value.port === PORT, 'LAB_TARGET_NOT_ISOLATED');
    requireThat(value.database === `kc_fault_lab_${value.runId}` && value.user === USER, 'LAB_TARGET_NOT_ISOLATED');
    requireThat(typeof value.serverUuid === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.serverUuid), 'LAB_INVALID_SERVER_UUID');
    return Object.freeze({ ...value });
}
function validateEnvironment(env) {
    const forbidden = /^(?:DB_|MYSQL|MARIADB|KC_|GUEST_SHOP_|SUPABASE_|STRIPE_|PAYMENT_|PROXY_|ALL_PROXY$|HTTPS?_PROXY$|DATABASE_URL$|NODE_OPTIONS$|NODE_PATH$)/i;
    requireThat(!Object.keys(env).some(key => forbidden.test(key) && env[key] !== undefined), 'LAB_AMBIENT_ENV_REJECTED');
}
function readTarget(filename) {
    requireThat(typeof filename === 'string' && path.isAbsolute(filename) && path.extname(filename) === '.json' && !/(^|[\\/])\.env(?:[.\\/]|$)/.test(filename), 'LAB_TARGET_FILE_PATH');
    requireThat(fs.realpathSync(filename) === filename, 'LAB_TARGET_FILE_SYMLINK');
    const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
        const stat = fs.fstatSync(fd);
        requireThat(stat.isFile() && stat.size > 0 && stat.size <= 4096 && (stat.mode & 0o077) === 0, 'LAB_TARGET_FILE_PERMISSIONS');
        return validateTarget(JSON.parse(fs.readFileSync(fd, 'utf8')));
    } finally { fs.closeSync(fd); }
}
function parseArgs(args) {
    if (!args.length) return { mode: 'plan' };
    const parsed = {};
    for (let i = 0; i < args.length; i++) {
        const key = args[i];
        requireThat(['--plan', '--execute', '--config', '--ack', '--run-id'].includes(key) && !Object.hasOwn(parsed, key), 'LAB_INVALID_ARGUMENTS');
        if (['--plan', '--execute'].includes(key)) parsed[key] = true;
        else {
            requireThat(typeof args[i + 1] === 'string' && !args[i + 1].startsWith('--'), 'LAB_INVALID_ARGUMENTS');
            parsed[key] = args[++i];
        }
    }
    if (parsed['--execute']) {
        requireThat(!parsed['--plan'] && !parsed['--run-id'] && parsed['--config'] && parsed['--ack'] === ACK, 'LAB_EXECUTION_NOT_ACKNOWLEDGED');
        return { mode: 'execute', filename: parsed['--config'] };
    }
    requireThat(parsed['--plan'] && !parsed['--config'] && !parsed['--ack'], 'LAB_INVALID_ARGUMENTS');
    if (parsed['--run-id']) validateRunId(parsed['--run-id']);
    return { mode: 'plan', runId: parsed['--run-id'] };
}
function errorCode(error) {
    const code = error?.code;
    return typeof code === 'string' && /^(?:LAB_[A-Z0-9_]+|ER_LOCK_DEADLOCK|ER_LOCK_WAIT_TIMEOUT|ECONNREFUSED|ECONNRESET|ETIMEDOUT|PROTOCOL_CONNECTION_LOST)$/.test(code) ? code : 'LAB_CASE_FAILED';
}
module.exports = { ACK, USER, PASSWORD, PORT, PURPOSE, TABLES, LabError, requireThat, digest,
    validateRunId, validateTarget, validateEnvironment, readTarget, parseArgs, errorCode };
