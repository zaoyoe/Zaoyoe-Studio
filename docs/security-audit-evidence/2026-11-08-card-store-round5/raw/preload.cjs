// Local offline test guard: Node APIs only; not an operating-system sandbox.
'use strict';
const fs = require('node:fs');
const net = require('node:net');
const tls = require('node:tls');
const dgram = require('node:dgram');
const { fileURLToPath } = require('node:url');
const append = fs.appendFileSync.bind(fs);
function check(file) {
  if (typeof file === 'number') return;
  const name = file instanceof URL ? fileURLToPath(file) : String(file);
  if (/(^|[\\/])\.env(?:$|[.][^\\/]+$)/.test(name) && !/[.](example|sample|template)(?:$|[.])/.test(name)) {
    append('/tmp/security-test-isolation-20261108/blocked-reads.jsonl', JSON.stringify({path:name})+'\n');
    throw new Error('TEST_ENV_FILE_READ_BLOCKED');
  }
}
for (const key of ['readFileSync','readFile','openSync','open','createReadStream']) {
  const original = fs[key]; fs[key] = function(file,...args) { check(file); return original.call(this,file,...args); };
}
for (const key of ['readFile','open']) {
  const original = fs.promises[key]; fs.promises[key] = function(file,...args) { check(file); return original.call(this,file,...args); };
}
if (process.loadEnvFile) process.loadEnvFile = () => { throw new Error('TEST_ENV_LOAD_BLOCKED'); };
const blocked = () => { throw new Error('TEST_NETWORK_CONNECT_BLOCKED'); };
net.Socket.prototype.connect = blocked; net.connect = blocked; net.createConnection = blocked;
tls.connect = blocked; dgram.createSocket = blocked;
