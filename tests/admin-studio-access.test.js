const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const sub = '11111111-1111-4111-8111-111111111111';
const sid = '22222222-2222-4222-8222-222222222222';
const secret = 'test-admin-studio-secret';
function signed(p) {
    const body = Buffer.from(JSON.stringify(p)).toString('base64url');
    return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
test('admin studio v2 token binds a user, grant and bounded lifetime', async () => {
    process.env.ADMIN_STUDIO_ACCESS_SECRET = secret;
    const helpers = await import('../api/_lib/admin-studio-access.mjs');
    const token = await helpers.issueAdminStudioToken({ sub, sid, exp: Math.floor(Date.now()/1000)+120 });
    const payload = await helpers.verifyAdminStudioToken(token);
    assert.equal(payload.sub, sub);
    assert.equal(payload.sid, sid);
    assert.equal(payload.v, 2);
    assert.equal(payload.scope, 'admin-studio');
    assert.equal(await helpers.verifyAdminStudioToken(`${token.slice(0,-1)}!`), null);
    assert.equal(await helpers.verifyAdminStudioToken(`${token}.extra`), null);
    assert.equal(await helpers.verifyAdminStudioToken('a'.repeat(2049)), null);
});
test('admin studio rejects signed legacy, malformed, expired and oversized claims', async () => {
    process.env.ADMIN_STUDIO_ACCESS_SECRET = secret;
    const helpers = await import('../api/_lib/admin-studio-access.mjs');
    const now = Math.floor(Date.now()/1000);
    const base = { v:2, scope:'admin-studio', sub, sid, iat:now, exp:now+120 };
    for (const patch of [
        {v:1}, {sub:'user-123'}, {sid:null}, {sid:'bad-id'}, {scope:'other'},
        {iat:now+30}, {iat:now+0.5}, {exp:now-1}, {exp:now+0.5}, {exp:now+3601},
        {iat:now-3601, exp:now+1}
    ]) assert.equal(await helpers.verifyAdminStudioToken(signed({...base, ...patch})), null, JSON.stringify(patch));
    await assert.rejects(helpers.issueAdminStudioToken({sub, exp:now+120}), /Invalid/);
    await assert.rejects(helpers.issueAdminStudioToken({sub, sid, exp:now-1}), /Invalid/);
});
