'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');

const {
    createKcPreviewApp,
    resolveLocalPreviewSourceState
} = require('../scripts/local-preview-kc');

const repoRoot = path.resolve(__dirname, '..');

test('local preview resolves git source state correctly', () => {
    const state = resolveLocalPreviewSourceState(repoRoot);
    assert.equal(state.service, 'kc-pay-gpt');
    assert.match(state.sourceCommit, /^[0-9a-f]{40}$/);
    assert.equal(typeof state.workingTreeDirty, 'boolean');
    assert.equal(state.backend, 'preview-mock');
});

test('local preview app serves KC public and admin pages', async (t) => {
    const { app } = createKcPreviewApp({ port: 0 });
    const server = http.createServer(app);

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => server.close());

    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    // 1. Preview diagnostics endpoint
    const previewRes = await fetch(`${base}/__preview`);
    assert.equal(previewRes.status, 200);
    const previewData = await previewRes.json();
    assert.equal(previewData.service, 'kc-pay-gpt');
    assert.equal(previewRes.headers.get('cache-control'), 'no-store, no-cache, must-revalidate');

    // 2. Healthz endpoint
    const healthRes = await fetch(`${base}/healthz`);
    assert.equal(healthRes.status, 200);
    const healthData = await healthRes.json();
    assert.equal(healthData.status, 'ok');

    // 3. User redeem page
    const redeemRes = await fetch(`${base}/`);
    assert.equal(redeemRes.status, 200);
    const redeemHtml = await redeemRes.text();
    assert.match(redeemHtml, /KC ChatGPT/);

    // 4. Admin console page
    const adminRes = await fetch(`${base}/admin`);
    assert.equal(adminRes.status, 200);
    const adminHtml = await adminRes.text();
    assert.match(adminHtml, /KC GPT自动充值系统/);

    // 5. Admin login page
    const loginRes = await fetch(`${base}/admin-login`);
    assert.equal(loginRes.status, 200);
    const loginHtml = await loginRes.text();
    assert.match(loginHtml, /后台登录/);

    // 6. Cards API with PR #704 fields (max_usage_limit, unconfirmed_auto_renew)
    const cardsRes = await fetch(`${base}/api/admin/cards`);
    assert.equal(cardsRes.status, 200);
    const cardsData = await cardsRes.json();
    assert.equal(cardsData.success, true);
    assert.ok(Array.isArray(cardsData.cards));
    assert.ok(cardsData.config && typeof cardsData.config.max_usage_limit === 'number');
    assert.ok(cardsData.unconfirmed_auto_renew && Array.isArray(cardsData.unconfirmed_auto_renew.tasks));

    // 7. Update max usage limit
    const updateLimitRes = await fetch(`${base}/api/admin/cards/max-usage-limit`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ max_usage_limit: 25 })
    });
    assert.equal(updateLimitRes.status, 200);
    const updateData = await updateLimitRes.json();
    assert.equal(updateData.max_usage_limit, 25);

    // 8. CDKs API with PR #704 fields (card_last4, auto_renew_status)
    const cdksRes = await fetch(`${base}/api/admin/cdks`);
    assert.equal(cdksRes.status, 200);
    const cdksData = await cdksRes.json();
    assert.equal(cdksData.success, true);
    assert.ok(Array.isArray(cdksData.cdks));
    assert.equal(cdksData.cdks[0].card_last4, '1234');
    assert.equal(cdksData.cdks[0].auto_renew_status, 'cancelled');
});

test('frontend and backend contracts for payment success feedback', () => {
    const fs = require('node:fs');
    const indexHtml = fs.readFileSync(path.join(repoRoot, 'services/kc-pay-gpt/public/index.html'), 'utf8');
    const serverJs = fs.readFileSync(path.join(repoRoot, 'services/kc-pay-gpt/server.js'), 'utf8');

    // Frontend: ensures paymentState === 'succeeded' yields success prompt and completes user recharge flow
    assert.match(indexHtml, /isRechargeSucceeded = status === 'success' \|\| paymentState === 'succeeded'/);
    assert.match(indexHtml, /cdkLabel\.textContent = '已使用'/);
    assert.match(indexHtml, /🎉 恭喜！当前账号已成功开通/);

    // Backend: ensures payment success affirmatively locks finalStatus = 'success' and broadcasts success to client
    assert.match(serverJs, /isPaymentSucceeded/);
    assert.match(serverJs, /finalStatus = 'success'/);
    assert.match(serverJs, /paymentState: 'succeeded'/);
});
