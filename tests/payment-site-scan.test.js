const test = require('node:test');
const assert = require('node:assert/strict');

const {
    DEFAULT_ENV_FILE,
    parseArgs
} = require('../scripts/scan-payment-site-values');

test('scan-payment-site-values defaults to the production env file', () => {
    const options = parseArgs([]);
    assert.equal(options.envFile, DEFAULT_ENV_FILE);
    assert.match(options.envFile, /server\/\.env\.production$/);
});

test('scan-payment-site-values still allows explicit env file overrides', () => {
    const options = parseArgs(['--env-file', 'server/.env.staging', '--sample-limit', '5']);
    assert.match(options.envFile, /server\/\.env\.staging$/);
    assert.equal(options.sampleLimit, 5);
});
