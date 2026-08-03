const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('NewAPI canonical domain keeps the legacy ingress as a compatibility alias', () => {
    for (const relativePath of [
        'deploy/kvm4/caddy/sub2api-newapi.caddy.tmpl',
        'deploy/kvm4/caddy/sub2api-maintenance.caddy.tmpl'
    ]) {
        const source = readRepoFile(relativePath);
        assert.match(source, /new\.fatherkey\.com/);
        assert.match(source, /sub2api\.fatherkey\.com/);
    }

    const compose = readRepoFile('deploy/kvm4/docker-compose.sub2api.yml');
    assert.match(
        compose,
        /SESSION_COOKIE_TRUSTED_URL=https:\/\/new\.fatherkey\.com,https:\/\/sub2api\.fatherkey\.com/
    );
});

test('NewAPI deployment checks the canonical and compatibility public routes', () => {
    const workflow = readRepoFile('.github/workflows/deploy-kvm4-sub2api.yml');
    assert.match(workflow, /https:\/\/new\.fatherkey\.com\/health/);
    assert.match(workflow, /https:\/\/sub2api\.fatherkey\.com\/health/);

    const deploy = readRepoFile('scripts/deploy-kvm4-sub2api.sh');
    assert.match(deploy, /new\.fatherkey\.com/);
    assert.match(deploy, /sub2api\[\.\]fatherkey\[\.\]com/);
    assert.match(deploy, /canonical_site_count/);
    assert.match(deploy, /compatibility_site_count/);
});
