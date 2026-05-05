const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const smoke = require('../scripts/engagement-external-embed-smoke');

const ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('external embed smoke parses deployment probe options', () => {
    const options = smoke.parseArgs([
        '--base-url', 'http://127.0.0.1:3000',
        '--asset-base', 'https://www.zaoyoe.com/',
        '--api-origin', 'https://www.zaoyoe.com',
        '--page-id', 'gongyi',
        '--site', 'intl',
        '--timeout-ms', '12345',
        '--keep-open'
    ]);

    assert.equal(options.baseUrl, 'http://127.0.0.1:3000');
    assert.equal(options.assetBase, 'https://www.zaoyoe.com/');
    assert.equal(options.apiOrigin, 'https://www.zaoyoe.com');
    assert.equal(options.pageId, 'gongyi');
    assert.equal(options.site, 'intl');
    assert.equal(options.timeoutMs, 12345);
    assert.equal(options.keepOpen, true);
});

test('external embed smoke probe page loads the production embed contract', () => {
    const html = smoke.buildExternalProbeHtml({
        assetBase: 'https://www.zaoyoe.com/',
        apiOrigin: 'https://www.zaoyoe.com',
        pageId: 'gongyi',
        site: 'cn'
    });

    assert.match(html, /engagement-external-embed\.js\?v=20260505_GONGYI_EXTERNAL_ENGAGEMENT_1/);
    assert.match(html, /data-page-id="gongyi"/);
    assert.match(html, /data-api-origin="https:\/\/www\.zaoyoe\.com"/);
    assert.match(html, /data-asset-base="https:\/\/www\.zaoyoe\.com\/"/);
    assert.match(html, /__externalEmbedSmoke/);
    assert.match(html, /credentials/);
    assert.match(html, /external_embed_smoke/);
    assert.match(html, /My Wallet > Cards/);
});

test('external embed smoke validates CORS probe failures explicitly', () => {
    const failed = smoke.evaluateCorsProbe({
        statusCode: 403,
        headers: {}
    }, 'http://127.0.0.1:4321');

    assert.equal(failed.status, 'failed');
    assert.ok(failed.failures.some((failure) => failure.includes('expected 204')));
    assert.ok(failed.failures.some((failure) => failure.includes('Access-Control-Allow-Origin')));
});

test('external embed smoke is wired into package scripts and admin diagnostics', () => {
    const packageJson = JSON.parse(readRepoFile('package.json'));
    const policy = readRepoFile('api/_lib/engagement-external-policy.js');
    const adminJs = readRepoFile('js/admin-engagement.js');
    const publicSmoke = readRepoFile('scripts/engagement-public-visual-smoke.js');

    assert.equal(packageJson.scripts['smoke:engagement-external'], 'node scripts/engagement-external-embed-smoke.js');
    assert.match(policy, /smoke_command:\s*'npm run smoke:engagement-external'/);
    assert.match(policy, /deployment_steps/);
    assert.match(adminJs, /engagement-external-command/);
    assert.match(adminJs, /本地模拟验收/);
    assert.match(adminJs, /deployment_steps/);
    assert.match(publicSmoke, /createPageSession/);
    assert.match(publicSmoke, /startLocalPreviewServer/);
});
