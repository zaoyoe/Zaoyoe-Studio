const test = require('node:test');
const assert = require('node:assert/strict');

async function loadHelpers() {
    return import('../api/_lib/admin-studio-access.mjs');
}

test('admin studio token issues and verifies with configured secret', async () => {
    process.env.ADMIN_STUDIO_ACCESS_SECRET = 'test-admin-studio-secret';

    const helpers = await loadHelpers();
    const token = await helpers.issueAdminStudioToken({ sub: 'user-123', exp: Math.floor(Date.now() / 1000) + 120 });
    const payload = await helpers.verifyAdminStudioToken(token);

    assert.equal(typeof token, 'string');
    assert.equal(payload?.sub, 'user-123');
    assert.equal(payload?.scope, 'admin-studio');
});

test('admin studio token rejects tampering and expiry', async () => {
    process.env.ADMIN_STUDIO_ACCESS_SECRET = 'test-admin-studio-secret';

    const helpers = await loadHelpers();
    const expiredToken = await helpers.issueAdminStudioToken({ sub: 'user-123', exp: Math.floor(Date.now() / 1000) - 5 });
    const validToken = await helpers.issueAdminStudioToken({ sub: 'user-123', exp: Math.floor(Date.now() / 1000) + 120 });
    const tamperedToken = `${validToken.slice(0, -1)}x`;

    assert.equal(await helpers.verifyAdminStudioToken(expiredToken), null);
    assert.equal(await helpers.verifyAdminStudioToken(tamperedToken), null);
});
