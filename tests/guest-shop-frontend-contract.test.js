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
    assert.match(client, /void pollStatus\(\{ immediate: true, resetWindow: true, forceProviderRefresh: true \}\)/);
    assert.match(client, /pollGeneration/);
    assert.match(client, /generation !== state\.pollGeneration/);
    assert.match(client, /if \(generation !== state\.pollGeneration \|\| !state\.orderNo\) return;/);
    assert.match(client, /\} catch \(error\) \{[\s\S]*if \(generation !== state\.pollGeneration \|\| !state\.orderNo\) return;[\s\S]*guest_claim_invalid/);
    assert.match(client, /当前设备的取货凭证不可用，请勿重复付款/);
});

test('manual status check forces a live provider query while background polling does not', () => {
    assert.match(client, /async function fetchStatus\(\{ forceRefresh = false \} = \{\}\)/);
    assert.match(client, /if \(forceRefresh\) query\.set\('force_provider_refresh', '1'\)/);
    assert.match(client, /async function pollStatus\(\{ immediate = false, resetWindow = false, forceProviderRefresh = false \} = \{\}\)/);
    assert.match(client, /await fetchStatus\(\{ forceRefresh: forceProviderRefresh \}\)/);
    // The automatic poll path stays non-forced so it cannot bypass the server throttle.
    assert.match(client, /void pollStatus\(\{ immediate: true \}\)/);
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

test('created guest orders surface the non-secret order number in the existing summary', () => {
    assert.match(markup, /id="guestCashOrderNoRow"[^>]*class="guest-shop-modal__summary-row"/);
    assert.match(markup, /id="guestCashOrderNo"/);
    assert.match(client, /function showOrderNo\(orderNo\)/);
    assert.match(client, /showOrderNo\(orderNo\)/);
    assert.match(client, /showOrderNo\(state\.orderNo\)/);
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
    assert.match(markup, /应付金额/);
    assert.match(client, /function formatAmount\(amount\)/);
    assert.match(client, /style:\s*'currency',\s*currency:\s*'CNY'/);
    assert.doesNotMatch(client, /currency:\s*'USD'/);
});

test('guest ZPay checkout hosts an in-page Alipay QR and countdown instead of opening WAP', () => {
    const guestModalStart = markup.indexOf('id="guestCashPurchaseModal"');
    const guestModalEnd = markup.indexOf('id="guestCashPurchaseDismissBtn"');
    assert.ok(guestModalStart >= 0 && guestModalEnd > guestModalStart, 'guest cash modal markup must exist');
    const guestModal = markup.slice(guestModalStart, guestModalEnd);
    assert.doesNotMatch(guestModal, /id="guestCashCheckoutLink"/);
    assert.doesNotMatch(guestModal, /打开支付页面/);
    assert.doesNotMatch(guestModal, /target="_blank"/);
    assert.match(markup, /id="guestCashZpayQrImage"[^>]*class="guest-shop-modal__qr-image"/);
    assert.match(markup, /id="guestCashZpayCountdown"[^>]*class="guest-shop-modal__qr-countdown"/);
    assert.match(markup, /id="guestCashZpayOpenBtn"[^>]*hidden/);
    assert.match(markup, /请使用支付宝扫码支付/);
    assert.match(markup, /打开支付宝支付/);
    assert.match(markup, /guestPayableFee=20260916_GUEST_PAYABLE_FEE_2/);
    assert.match(markup, /js\/guest-shop-client\.js\?v=20260916_GUEST_STATUS_ACTIVE_REFRESH_1/);

    assert.match(styles, /\.guest-shop-modal__qr-card/);
    assert.match(styles, /\.guest-shop-modal__qr-countdown/);
    assert.match(styles, /\.guest-shop-modal__qr-image/);
    assert.match(styles, /html:not\(\[data-theme="dark"\]\) body\.shop-page \.guest-shop-modal__qr-card/);
    assert.doesNotMatch(markup, /href="css\/wallet\.css/);

    assert.match(client, /function checkoutDetails\(checkout\)/);
    assert.match(client, /qrcodeUrl:\s*safePaymentUrl\(source\.qrcode_url\)/);
    assert.match(client, /qrcodeImageUrl:\s*safePaymentUrl\(source\.qrcode_image_url \|\| source\.qrcode_img_url\)/);
    assert.match(client, /function isHostedPaymentQrDesktopLayout\(\)/);
    assert.match(client, /function isMobileAlipayHandoff\(\)/);
    assert.match(client, /return isMobilePaymentBrowser\(\) && !isHostedPaymentQrDesktopLayout\(\);/);
    assert.match(client, /function presentZpayHostedQr\(details\)/);
    assert.match(client, /function startZpayCountdown\(\)/);
    assert.match(client, /function buildQrImageUrl\(data, size = 240\)/);
    assert.match(client, /hostedImageUrl = isMobileHandoff[\s\S]*details\.qrcodeImageUrl \|\| buildQrImageUrl\(qrcodeUrl \|\| checkoutUrl\)/);
    assert.match(client, /alipays:\/\/platformapi\/startapp\?appId=20000067&url=/);
    assert.match(client, /window\.location\.href = launchUrl/);
    assert.match(client, /if \(launchUrl && isMobileAlipayHandoff\(\)\)/);
    assert.match(client, /setHidden\('guestCashConfigurePanel', true\)/);
    assert.match(client, /presentZpaySuccess\(\)/);
    assert.doesNotMatch(client, /window\.open\s*\(/);
    assert.doesNotMatch(client, /location\.assign\s*\(/);
    assert.doesNotMatch(client, /guestCashCheckoutLink/);
    assert.doesNotMatch(client, /不要在电脑浏览器打开支付宝链接[\s\S]{0,80}window\.location/);
});

test('unpaid guest orders can be abandoned locally without a cancel RPC', () => {
    assert.match(markup, /id="guestCashAbandonOrderBtn"[^>]*class="shop-btn shop-btn-secondary"/);
    assert.match(markup, /id="guestCashAbandonOrderBtn"[^>]*hidden/);
    assert.match(markup, /id="guestCashAbandonOrderBtn"[^>]*>关闭当前订单</);
    assert.match(markup, /guestPayableFee=20260916_GUEST_PAYABLE_FEE_2/);
    assert.match(markup, /js\/guest-shop-client\.js\?v=20260916_GUEST_STATUS_ACTIVE_REFRESH_1/);

    assert.match(client, /function clearStoredCheckout\(\)/);
    assert.match(client, /function isAbandonableOrder\(\)/);
    assert.match(client, /function abandonCurrentOrder\(\)/);
    assert.match(client, /storage\.removeItem\(STORAGE_KEY\)/);
    assert.match(client, /function abandonCurrentOrder\(\)[\s\S]*clearStoredCheckout\(\)/);
    assert.match(client, /function abandonCurrentOrder\(\)[\s\S]*state\.idempotencyKey = ['"]['"]/);
    assert.match(client, /function isAbandonableOrder\(\)[\s\S]*state\.status === ['"]delivered['"]/);
    assert.match(client, /function isAbandonableOrder\(\)[\s\S]*state\.paymentConfirmed/);
    assert.match(client, /当前订单已确认付款或已发货，不能关闭/);
    assert.match(client, /请不要再支付旧付款码/);
    assert.match(client, /target\.closest\(['"]#guestCashAbandonOrderBtn['"]\)/);
    assert.match(client, /#guestCashPurchaseCloseBtn, #guestCashPurchaseDismissBtn/);

    assert.doesNotMatch(client, /\/api\/shop\/guest\/cancel/);
    assert.doesNotMatch(client, /fn_guest_shop_cancel/);
    assert.doesNotMatch(client, /window\.open\s*\(/);
    assert.doesNotMatch(markup, /id="guestCashCheckoutLink"/);
    assert.doesNotMatch(client, /guestCashCheckoutLink/);
});

test('guest checkout auto-adds a 1% channel fee to Alipay and USDT payable amounts', () => {
    assert.match(markup, /id="guestCashProductAmount"/);
    assert.match(markup, /id="guestCashFeeRow"[^>]*hidden/);
    assert.match(markup, /id="guestCashFeeLabel"[^>]*>通道手续费</);
    assert.match(markup, /id="guestCashFeeAmount"/);
    assert.match(markup, /应付金额/);
    assert.match(markup, /guestPayableFee=20260916_GUEST_PAYABLE_FEE_2/);
    assert.match(markup, /js\/guest-shop-client\.js\?v=20260916_GUEST_STATUS_ACTIVE_REFRESH_1/);

    assert.match(client, /function paymentProviderSummary\(provider\)/);
    assert.match(client, /const fallbackRate = \(key === ['"]zpay['"] \|\| key === ['"]nowpayments['"]\) \? 0\.01 : 0;/);
    assert.match(client, /const parsedRate = normalizeSurchargeRate\(summary\?\.surcharge_rate, fallbackRate\)/);
    assert.match(client, /surcharge_rate:\s*parsedRate > 0 \? parsedRate : fallbackRate/);
    assert.match(client, /function computePreviewPricing\(\)/);
    assert.match(client, /roundUpMoneyAmount\(baseAmount \* summary\.surcharge_rate\)/);
    assert.match(client, /setText\(['"]guestCashPrice['"], formatAmount\(pricing\?\.payableAmount\)\)/);
    assert.match(client, /setHidden\(['"]guestCashFeeRow['"], !\(surchargeAmount > 0\)\)/);
    assert.doesNotMatch(client, /surcharge_rate:\s*normalizeSurchargeRate\(summary\?\.surcharge_rate, fallbackRate\)/);
});
