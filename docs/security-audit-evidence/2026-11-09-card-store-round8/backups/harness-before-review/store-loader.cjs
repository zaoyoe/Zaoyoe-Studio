'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { LabError, USER, PASSWORD } = require('./safety.cjs');
const STORE_PATH = path.resolve(__dirname, '../../mysql-store.js');
// Only the card-lock methods are exercised. Unrelated application integrations
// are deliberately unavailable; this does not boot server.js or ensureReady().
const unused = new Proxy(Object.create(null), { get() {
    return () => { throw new LabError('LAB_UNEXERCISED_DEPENDENCY'); };
} });
const support = new Set(['./proxy-pool', './captcha-platform', './session-security', './credential-security',
    './task-safety', './admin-auth', './admin-paths', './region-config', './card-validator']);
function loadStore(pool, target) {
    const module = { exports: {} };
    const env = Object.freeze({ DB_HOST: target.host, DB_PORT: String(target.port), DB_NAME: target.database,
        DB_USER: USER, DB_PASSWORD: PASSWORD, ASSET_LOCK_STALE_MS: '1000' });
    vm.runInNewContext(fs.readFileSync(STORE_PATH, 'utf8'), {
        module, exports: module.exports, __dirname: path.dirname(STORE_PATH), Buffer, URL,
        process: Object.freeze({ env }), console: unused,
        require(name) {
            if (name === 'mysql2/promise') return { createPool: () => pool };
            if (name === 'path' || name === 'crypto') return require(`node:${name}`);
            if (name === 'fs' || support.has(name)) return unused;
            if (name === './cdk-plan-catalog') return { PLAN_NAME_MAP: {} };
            throw new LabError('LAB_UNEXPECTED_IMPORT');
        }
    }, { filename: STORE_PATH, timeout: 5000, contextCodeGeneration: { strings: false, wasm: false } });
    return module.exports;
}
// These are deterministic client-side fault boundaries. An after-ack fault
// discards a real successful response; it is not evidence of packet-loss timing.
function transactionFaultPool(pool, phase, original = new LabError('LAB_COMMIT_RESPONSE_DISCARDED')) {
    return {
        async getConnection() {
            const c = await pool.getConnection();
            return {
                query: (...args) => c.query(...args),
                beginTransaction: () => c.beginTransaction(),
                async commit() {
                    if (phase === 'after_ack') await c.commit();
                    else if (phase !== 'before_send') throw new LabError('LAB_INVALID_FAULT_PHASE');
                    c.destroy();
                    throw original;
                },
                async rollback() { throw new LabError('LAB_ROLLBACK_CONNECTION_GONE'); },
                release: () => c.destroy()
            };
        }
    };
}
function autocommitFaultPool(pool) {
    return {
        async execute(...args) {
            const c = await pool.getConnection();
            try {
                await c.execute(...args);
                c.destroy();
                throw new LabError('LAB_WRITE_RESPONSE_DISCARDED');
            } finally { c.destroy(); }
        }
    };
}
module.exports = { STORE_PATH, loadStore, transactionFaultPool, autocommitFaultPool };
