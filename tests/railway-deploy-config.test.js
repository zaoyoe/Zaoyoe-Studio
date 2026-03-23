const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('repo root railway.toml deploys the verify server from the repository root', () => {
    const railwayConfigPath = path.resolve(__dirname, '../railway.toml');
    const source = fs.readFileSync(railwayConfigPath, 'utf8');

    assert.match(source, /\[deploy\]/);
    assert.match(source, /startCommand = "node server\/index\.js"/);
    assert.match(source, /healthcheckPath = "\/healthz"/);
});

test('verify server entrypoint still depends on repo-root shared modules', () => {
    const serverEntryPath = path.resolve(__dirname, '../server/index.js');
    const source = fs.readFileSync(serverEntryPath, 'utf8');

    assert.match(source, /\.\.\/api\/_lib\/payments\/provider-adapters/);
    assert.match(source, /\.\.\/api\/_lib\/request-security/);
});
