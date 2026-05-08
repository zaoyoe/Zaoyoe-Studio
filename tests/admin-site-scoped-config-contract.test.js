const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('admin settings frontend carries site filter through site-scoped config reads and writes', () => {
    const adminConfigSource = readRepoFile('admin-config.js');

    assert.match(adminConfigSource, /const ADMIN_SITE_SCOPED_SYSTEM_CONFIG_KEYS = new Set\(\[/);
    assert.match(adminConfigSource, /searchParams\.set\('site', getAdminSettingsSiteFilterValue\(\)\)/);
    assert.match(adminConfigSource, /const isSiteScoped = isAdminSiteScopedSystemConfigKey\(key\);/);
    assert.match(adminConfigSource, /site: isSiteScoped \? writableSite : undefined/);
    assert.match(adminConfigSource, /fetch\(`\/api\/admin\/settings\/payment-channels\?site=\$\{encodeURIComponent\(site\)\}`/);
    assert.match(adminConfigSource, /const writableSite = requireWritableAdminSettingsSite\('保存支付通道配置'\);/);
});
