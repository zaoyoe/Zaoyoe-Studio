const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('chat widget writes, reads, and subscribes with the current site context', () => {
    const source = readRepoFile(path.join('js', 'components', 'ChatWidget.js'));

    assert.match(source, /site:\s*this\.getCurrentSite\(\)/);
    assert.match(source, /filter:\s*this\.getCurrentSiteRealtimeFilter\(\)/);
    assert.match(source, /\.eq\('site',\s*this\.getCurrentSite\(\)\)/);
    assert.match(source, /body:\s*JSON\.stringify\(\{\s*action,\s*input,\s*site:\s*this\.getCurrentSite\(\)/s);
});

test('support endpoint and admin notification helper both persist site-scoped records', () => {
    const supportSource = readRepoFile(path.join('api', 'support.js'));
    const notificationsSource = readRepoFile(path.join('api', '_lib', 'admin-notifications.js'));

    assert.match(supportSource, /site:\s*normalizedSite/);
    assert.match(notificationsSource, /site:\s*normalizedSite/);
    assert.match(notificationsSource, /metadata:\s*metadata[\s\S]*site:\s*normalizeSiteValue\(metadata\.site \|\| normalizedSite/s);
});
