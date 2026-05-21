#!/usr/bin/env node

const bridgeWorker = require('./bridge-worker');

if (require.main === module) {
    bridgeWorker.main().catch((error) => {
        process.stderr.write(`${error?.message || error}\n`);
        process.exitCode = 1;
    });
}

module.exports = bridgeWorker;