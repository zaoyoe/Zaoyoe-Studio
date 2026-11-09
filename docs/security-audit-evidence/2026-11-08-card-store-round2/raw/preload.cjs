"use strict";
// External test harness only; never imported by application runtime.
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { syncBuiltinESMExports } = require('node:module');
const repo = '/Volumes/chao/AI/xianyu_profit_calculator';
const audit = '/tmp/security-test-isolation-20261108/blocked-reads.jsonl';
const append = fs.appendFileSync.bind(fs);
function blocked(input) {
    if (typeof input === 'number') return false;
    let value = input;
    if (value instanceof URL) { if (value.protocol !== 'file:') return false; value = fileURLToPath(value); }
    if (Buffer.isBuffer(value)) value = value.toString();
    if (typeof value !== 'string') return false;
    const absolute = path.resolve(value);
    const name = path.basename(absolute);
    return (absolute === repo || absolute.startsWith(repo + path.sep)) && /^\.env(?:\.|$)/u.test(name) && !/\.(?:example|sample|template)$/u.test(name);
}
function denied(input, method) {
    append(audit, JSON.stringify({ pid: process.pid, method, path: String(input) }) + '\n', { mode: 0o600 });
    const error = new Error('ENOENT: real repository environment files are isolated during tests');
    error.code = 'ENOENT'; error.errno = -2; error.syscall = method;
    return error;
}
for (const method of ['readFileSync', 'openSync', 'statSync', 'lstatSync', 'accessSync']) {
    const original = fs[method];
    fs[method] = function(input, ...args) { if (blocked(input)) throw denied(input, method); return original.call(this, input, ...args); };
}
const exists = fs.existsSync;
fs.existsSync = function(input) { if (blocked(input)) { denied(input, 'existsSync'); return false; } return exists.call(this, input); };
for (const method of ['readFile', 'open', 'stat', 'lstat', 'access']) {
    const original = fs[method];
    fs[method] = function(input, ...args) {
        if (!blocked(input)) return original.call(this, input, ...args);
        const error = denied(input, method); const cb = args[args.length - 1];
        if (typeof cb === 'function') return queueMicrotask(() => cb(error));
        throw error;
    };
}
for (const method of ['readFile', 'open', 'stat', 'lstat', 'access']) {
    const original = fs.promises[method];
    fs.promises[method] = async function(input, ...args) { if (blocked(input)) throw denied(input, 'promises.' + method); return original.call(this, input, ...args); };
}
const createReadStream = fs.createReadStream;
fs.createReadStream = function(input, ...args) { if (blocked(input)) throw denied(input, 'createReadStream'); return createReadStream.call(this, input, ...args); };
if (typeof process.loadEnvFile === 'function') {
    const loadEnvFile = process.loadEnvFile;
    process.loadEnvFile = function(input = '.env') { if (blocked(input)) throw denied(input, 'process.loadEnvFile'); return loadEnvFile.call(this, input); };
}
// Tests may use local HTTP fixtures, but must not connect to external services.
const net = require('node:net');
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function(...args) {
    let first = args[0]; if (Array.isArray(first)) first = first[0];
    const options = first && typeof first === 'object' ? first : {};
    if (options.path || typeof first === 'string' && !/^\d+$/u.test(first)) throw new Error('test isolation: Unix socket connection blocked');
    const host = String(options.host || (typeof args[1] === 'string' ? args[1] : 'localhost')).toLowerCase();
    if (!['localhost', '127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(host)) throw new Error('test isolation: external network connection blocked');
    return connect.apply(this, args);
};
syncBuiltinESMExports();
