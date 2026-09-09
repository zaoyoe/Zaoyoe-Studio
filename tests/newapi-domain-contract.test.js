const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('NewAPI ingress is restricted to the canonical domain', () => {
    for (const relativePath of [
        'deploy/kvm4/caddy/sub2api-newapi.caddy.tmpl',
        'deploy/kvm4/caddy/sub2api-maintenance.caddy.tmpl'
    ]) {
        const source = readRepoFile(relativePath);
        assert.match(source, /new\.fatherkey\.com/);
        assert.doesNotMatch(source, /sub2api\.fatherkey\.com/);
    }

    const compose = readRepoFile('deploy/kvm4/docker-compose.sub2api.yml');
    assert.match(
        compose,
        /SESSION_COOKIE_TRUSTED_URL=https:\/\/new\.fatherkey\.com/
    );
    assert.doesNotMatch(compose, /legacy-sub2api:/);
});

test('legacy Sub2API source and local entrypoints are removed', () => {
    assert.equal(fs.existsSync(path.join(ROOT, 'services', 'sub2api')), false);

    const packageJson = readRepoFile('package.json');
    assert.doesNotMatch(packageJson, /services\/sub2api/);

    const compose = readRepoFile('deploy/kvm4/docker-compose.sub2api.yml');
    assert.doesNotMatch(compose, /zaoyoe\/sub2api:(?:legacy|local)/);
});

test('NewAPI deployment checks the canonical public route', () => {
    const workflow = readRepoFile('.github/workflows/deploy-kvm4-sub2api.yml');
    assert.match(workflow, /https:\/\/new\.fatherkey\.com\/health/);
    assert.doesNotMatch(workflow, /https:\/\/sub2api\.fatherkey\.com\/health/);

    const deploy = readRepoFile('scripts/deploy-kvm4-sub2api.sh');
    assert.match(deploy, /new\.fatherkey\.com/);
    assert.match(deploy, /canonical_site_count/);
    assert.doesNotMatch(deploy, /compatibility_site_count/);
});
