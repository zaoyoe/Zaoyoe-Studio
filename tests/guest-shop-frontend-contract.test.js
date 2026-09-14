'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const markup = read('shop.html');
const client = read('js/guest-shop-client.js');
const styles = read('css/shop-page.css');

test('shop page mounts the isolated guest cash checkout after the authenticated shop client', () => {
    const shopClientIndex = markup.indexOf('js/shop-client.js');
    const guestClientIndex = markup.indexOf('js/guest-shop-client.js');

    assert.ok(shopClientIndex >= 0, 'the existing shop client must remain mounted');
    assert.ok(guestClientIndex > shopClientIndex, 'guest checkout must initialize after the shop client');
    assert.match(markup, /id="guestCashPurchaseBtn"[^>]*hidden/);
    assert.match(markup, /id="guestCashPurchaseModal"[^>]*hidden/);
    assert.match(markup, /id="guestCashDeliveredContent"[^>]*class="guest-shop-modal__delivery-content"/);
    assert.match(styles, /\.guest-shop-modal__content/);
    assert.match(styles, /@media \(max-width: 600px\)[\s\S]*\.guest-shop-modal__actions/);
});

test('guest checkout uses only the public cash endpoints and same-origin cookie credentials', () => {
    assert.match(client, /const PREVIEW_ENDPOINT = ['"]\/api\/shop\/guest\/preview['"];/);
    assert.match(client, /const ORDER_ENDPOINT = ['"]\/api\/shop\/guest\/orders['"];/);
    assert.match(client, /const STATUS_ENDPOINT = ['"]\/api\/shop\/guest\/status['"];/);
    assert.match(client, /const CLAIM_ENDPOINT = ['"]\/api\/shop\/guest\/claim['"];/);
    assert.match(client, /const RECOVERY_ENDPOINT = ['"]\/api\/shop\/guest\/recover['"];/);
    assert.match(client, /credentials:\s*['"]same-origin['"]/);
    assert.match(client, /cache:\s*['"]no-store['"]/);
    assert.doesNotMatch(client, /localStorage/);
    assert.doesNotMatch(client, /supabase|access_token|Authorization\s*:/i);
    assert.doesNotMatch(client, /X-Guest-Claim-Secret|claimSecret|claim_secret/);
    assert.match(markup, /id="guestCashRecoveryCodePanel"/);
    assert.match(markup, /id="guestCashRecoveryPanel"/);
});

test('guest order creation fixes quantity to one and keeps secret material out of browser persistence and URLs', () => {
    assert.match(client, /const body = \{[\s\S]*quantity:\s*1,[\s\S]*idempotencyKey:/);
    const persistStart = client.indexOf('function persistCheckout()');
    const persistEnd = client.indexOf('\n    function hydrateCheckout', persistStart);
    const persistedCheckout = client.slice(persistStart, persistEnd);
    assert.match(persistedCheckout, /storage\.setItem\(STORAGE_KEY, JSON\.stringify\(\{[\s\S]*orderNo:[\s\S]*expiresAt:/);
    assert.doesNotMatch(persistedCheckout, /claim|secret/i);
    assert.doesNotMatch(persistedCheckout, /idempotencyKey/i);
    assert.match(client, /const STORAGE_VERSION = 3/);
    assert.doesNotMatch(client, /Math\.random\(\)/);
    assert.doesNotMatch(client, /searchParams\.set\([^)]*(?:secret|token|claim)/i);
    assert.match(client, /clearQueryReturnMarker\(\)/);
    assert.match(client, /回跳页面不会直接视为支付成功/);
    assert.match(client, /body:\s*JSON\.stringify\(\{\s*orderNo:\s*state\.orderNo\s*\}\)/);
});

test('guest delivery is claim-gated by confirmed payment and delivered fulfillment', () => {
    assert.match(
        client,
        /paymentStatus === ['"]confirmed['"] && fulfillmentStatus === ['"]delivered['"][\s\S]*await claimDelivery\(generation\)/
    );
    assert.match(client, /CLAIM_ENDPOINT[\s\S]*method:\s*['"]POST['"][\s\S]*credentials:\s*['"]same-origin['"]/);
    assert.match(client, /setText\(['"]guestCashDeliveredContent['"], payload\.content \|\| ['"]['"]\)/);
    assert.doesNotMatch(client, /innerHTML\s*=\s*[^;]*payload\.content/);
    assert.match(markup, /<pre id="guestCashDeliveredContent"/);
});

test('payment return markers only restore an order handle and do not unlock delivery', () => {
    assert.match(client, /readReturnOrderNo\(\)/);
    assert.match(client, /saved && saved\.orderNo === returnOrderNo/);
    assert.match(client, /else hydrateReturnOrderNo\(returnOrderNo\)/);
    assert.match(client, /void pollStatus\(\{ immediate: true \}\)/);
    assert.doesNotMatch(client, /readReturnOrderNo\(\)[\s\S]{0,300}(?:claimDelivery|setText\(['"]guestCashDeliveredContent)/);
});

test('payment return can recover in a fresh tab without persisting a claim secret', () => {
    assert.match(client, /function hydrateReturnOrderNo\(orderNo\)/);
    assert.match(client, /if \(saved && saved\.orderNo === returnOrderNo\) hydrateCheckout\(saved\);[\s\S]*else hydrateReturnOrderNo\(returnOrderNo\)/);
    assert.match(client, /openGuestModal\(null\);[\s\S]*回跳页面不会直接视为支付成功/);
    assert.match(client, /server-side claim cookie|HttpOnly proof cookie/);
    assert.doesNotMatch(client, /sessionStorage\.setItem\([\s\S]*returnOrderNo/);
    assert.match(client, /payload\?\.checkout && !state\.checkout/);
});

test('polling remains recoverable after transient fulfilment lag and manual retry resets its window', () => {
    assert.match(client, /paymentStatus === ['"]confirmed['"] && fulfillmentStatus === ['"]delivered['"][\s\S]*shouldContinue = state\.status === ['"]checking['"]/);
    assert.match(client, /void pollStatus\(\{ immediate: true, resetWindow: true \}\)/);
    assert.match(client, /pollGeneration/);
    assert.match(client, /generation !== state\.pollGeneration/);
    assert.match(client, /if \(generation !== state\.pollGeneration \|\| !state\.orderNo\) return;/);
    assert.match(client, /\} catch \(error\) \{[\s\S]*if \(generation !== state\.pollGeneration \|\| !state\.orderNo\) return;[\s\S]*guest_claim_invalid/);
    assert.match(client, /当前设备的取货凭证不可用，请勿重复付款/);
});

test('switching product or SKU cannot reuse the previous guest order context', () => {
    assert.match(client, /function resetActiveOrderForContext\(context\)/);
    assert.match(
        client,
        /resetActiveOrderForContext\(context\);[\s\S]*state\.contextKey = context\.contextKey/
    );
    assert.match(client, /state\.contextKey = state\.productId && state\.skuId/);
    assert.match(client, /resetActiveOrderForContext[\s\S]*stopPolling\(\)[\s\S]*state\.orderNo = ['"]['"]/);
    assert.match(client, /resetActiveOrderForContext[\s\S]*resetOrderUi\(\)/);
});

test('recovery code is displayed once, never persisted, and recover retries do not expect a new code', () => {
    assert.match(markup, /口令只显示一次，本站不会再次展示/);
    assert.match(client, /showRecoveryCode\(order\.recovery_code\)/);
    assert.match(client, /Create retries may re-emit the same derived code/);
    assert.match(client, /if \(state\.recoveryCode\) return;/);
    assert.match(client, /resetOrderUi\(\{ preserveRecovery: Boolean\(state\.recoveryCode\) \}\)/);
    assert.match(client, /function resetOrderUi\(\{ preserveRecovery = false \} = \{\}\)/);
    assert.match(client, /state\.recoveryCode = ''/);
    const persistStart = client.indexOf('function persistCheckout()');
    const persistEnd = client.indexOf('\n    function hydrateCheckout', persistStart);
    const persistedCheckout = client.slice(persistStart, persistEnd);
    assert.doesNotMatch(persistedCheckout, /recoveryCode|recovery_code|claim/i);
    assert.match(client, /body:\s*JSON\.stringify\(\{\s*orderNo,\s*recoveryCode\s*\}\)/);
    const eyebrowStart = styles.indexOf('.guest-shop-modal__eyebrow');
    assert.ok(eyebrowStart >= 0, 'guest checkout eyebrow must reuse shop styles');
    const eyebrowRule = styles.slice(eyebrowStart, styles.indexOf('}', eyebrowStart) + 1);
    assert.doesNotMatch(eyebrowRule, /text-transform:\s*uppercase/);
    assert.match(markup, /class="modal-content premium-modal guest-shop-modal__content"/);
    assert.match(markup, /class="shop-btn shop-btn-primary"/);
    assert.match(markup, /class="shop-btn shop-btn-secondary"/);
    assert.match(markup, /无需登录/);
    assert.doesNotMatch(markup, /Guest checkout/);
});

