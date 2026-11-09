const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const runbook = fs.readFileSync(
    path.join(ROOT, 'docs', 'admin-cloudflare-access-runbook.md'),
    'utf8'
);

test('admin Cloudflare Access runbook covers all three production entrypoints', () => {
    for (const host of [
        'www.fatherkey.com',
        'adm.fatherkey.com',
        'tg.adm.fatherkey.com'
    ]) {
        assert.match(runbook, new RegExp(host.replaceAll('.', '\\.'), 'u'));
    }
    assert.match(runbook, /www-authenticate:\s*Cloudflare-Access/u);
    assert.match(runbook, /PENDING 外部配置/u);
    assert.match(runbook, /Vercel 200/u);
});
