'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const markup = read('shop.html');
const client = read('js/guest-shop-client.js');
const shopClient = read('js/shop-client.js');
const styles = read('css/shop-page.css');
const guestShopHandler = read('server/api-handlers/public/guest-shop.js');
const zhLang = JSON.parse(read('lang/zh.json'));
const enLang = JSON.parse(read('lang/en.json'));

// The polling client and the server-side per-IP status budget must stay in sync,
// so read both instead of pinning magic interval numbers.
function parseSmartPollIntervals(source) {
    const block = /const SMART_POLL_INTERVALS = Object\.freeze\(\{([\s\S]*?)\}\);/.exec(source);
    assert.ok(block, 'SMART_POLL_INTERVALS must stay a frozen literal');
    const intervals = {};
    for (const line of block[1].split('\n')) {
        const entry = /^\s*([A-Z][A-Z_]*):\s*(\d+)/.exec(line);
        if (entry) intervals[entry[1]] = Number(entry[2]);
    }
    return intervals;
}

function parseStatusRateLimitPerMinute(source) {
    const match = /limit\(req, res, 'status', \{ limit: (\d+) \}\)/.exec(source);
    assert.ok(match, 'the guest status endpoint must keep an explicit rate limit');
    return Number(match[1]);
}

test('shop page mounts the isolated guest cash checkout after the authenticated shop client', () => {
    const shopClientIndex = markup.indexOf('js/shop-client.js');
    const guestClientIndex = markup.indexOf('js/guest-shop-client.js');

    assert.ok(shopClientIndex >= 0, 'the existing shop client must remain mounted');
    assert.ok(guestClientIndex > shopClientIndex, 'guest checkout must initialize after the shop client');
    assert.doesNotMatch(
        markup,
        /guestCashPurchaseBtn/,
        'the standalone 游客购买 button must stay removed from the product detail modal'
    );
    assert.match(markup, /id="nextPurchaseStepBtn"[^>]*class="shop-btn shop-btn-primary"/);
    assert.match(markup, /id="guestCashPurchaseModal"[^>]*hidden/);
    assert.match(markup, /id="guestCashDeliveredContent"[^>]*class="guest-shop-modal__delivery-content"/);
    assert.match(styles, /\.guest-shop-modal__content/);
    assert.match(styles, /@media \(max-width: 600px\)[\s\S]*\.guest-shop-modal__actions/);
});

test('the logged-out guest cash entry is merged into the primary purchase action', () => {
    // The guest script no longer watches the shop purchase modal or owns a button.
    assert.doesNotMatch(client, /guestCashPurchaseBtn/);
    assert.doesNotMatch(client, /shopPurchaseModal/);
    assert.doesNotMatch(client, /syncPurchaseButton|handlePurchaseButtonClick/);
    assert.doesNotMatch(client, /window\.setInterval\(syncPurchaseButton/);
    assert.match(client, /function loadPreview\(context\) \{/);
    assert.match(client, /async function runPreviewRequest\(context\) \{/);
    assert.doesNotMatch(client, /reason: 'pending' \};/);

    // It exposes only a routing bridge, and that bridge stays free of auth material.
    assert.match(
        client,
        /window\.GuestShopCheckout = \{\s*peekAvailability,\s*probeAvailability,\s*startGuestCheckout\s*\};/
    );
    assert.match(client, /function peekAvailability\(context = getPurchaseContext\(\)\) \{/);
    assert.match(client, /async function probeAvailability\(context = getPurchaseContext\(\)\) \{/);
    assert.match(client, /async function startGuestCheckout\(context = getPurchaseContext\(\)\) \{/);
    assert.match(client, /const TRANSIENT_AVAILABILITY_REASONS = new Set\(\['pending', 'rate_limited', 'preview_error'\]\);/);
    assert.match(client, /if \(!TRANSIENT_AVAILABILITY_REASONS\.has\(normalized\.reason\)\) \{/);

    // shop-client.js owns the auth decision and only routes logged-out visitors.
    assert.match(shopClient, /shopAuthStateKnown: null,/);
    assert.match(
        shopClient,
        /isGuestCashEntryActive: function \(\) \{\s*if \(this\.shopAuthStateKnown !== false\) return false;/
    );
    assert.match(shopClient, /startGuestCashCheckout: async function \(\) \{/);
    assert.match(shopClient, /window\.GuestShopCheckout/);
    assert.match(
        shopClient,
        /const token = await this\.getAccessToken\(\);[\s\S]*?if \(!token\) \{[\s\S]*?const guestEntry = await this\.startGuestCashCheckout\(\);[\s\S]*?if \(!guestEntry\.started\) \{[\s\S]*?this\.promptLoginForPurchase\(/
    );
    // Guest cash orders are one unit without coupons, so both stages collapse.
    assert.match(
        shopClient,
        /if \(guestCashActive\) \{\s*document\.querySelectorAll\(\s*'#shopPurchaseModal \.shop-purchase-stage-quantity, #shopPurchaseModal \.shop-purchase-stage-discount'\s*\)/
    );
    // The bridge cache is read synchronously before the stage copy is computed so
    // the merged label does not flash "兑换" on a reopened, already-probed product.
    assert.match(shopClient, /hydrateGuestCashEntryFromBridge: function \(\) \{/);
    assert.match(
        shopClient,
        /this\.hydrateGuestCashEntryFromBridge\(\);\s*\n\s*const copy = this\.getPurchaseStageCopy\(nextStage\);/
    );
    assert.match(shopClient, /nextLabel: guestCashActive/);
    assert.equal(zhLang.shop.guestCashBuyNow, '立即购买');
    assert.equal(enLang.shop.guestCashBuyNow, 'Buy now');

    // Guest orders are one unit, so the quantity is collapsed through the canonical
    // repricing path without paying for a coupon asset refresh.
    assert.match(
        shopClient,
        /applyGuestCashEntryQuantity: function \(\) \{[\s\S]*?this\.updatePriceForQuantity\(1, \{ refreshDiscountAssets: false \}\);/
    );
    assert.match(shopClient, /quantityInput\.disabled = isPurchaseProcessing \|\| isManualDelivery \|\| isSoldOut \|\| guestCashActive;/);

    // The user explicitly rejected an explanatory hint line for logged-out visitors.
    assert.doesNotMatch(shopClient, /未登录可直接现金购买/);
    assert.doesNotMatch(markup, /未登录可直接现金购买/);
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
    assert.match(client, /claimDelivery\(expectedGeneration[\s\S]*clearStoredCheckout\(\)/);
    assert.doesNotMatch(client, /claimDelivery\(expectedGeneration[\s\S]*persistCheckout\(\)/);
    assert.match(markup, /<pre id="guestCashDeliveredContent"/);
});

test('delivered guest orders are cleared when the modal closes and cannot be restored after refresh', () => {
    assert.match(client, /function clearCompletedCheckout\(\)/);
    assert.match(client, /function clearCompletedCheckout\(\)[\s\S]*state\.orderNo = ['"]['"][\s\S]*state\.status = ['"]configure['"][\s\S]*resetOrderUi\(\)/);
    assert.match(client, /function closeGuestModal\(\)[\s\S]*if \(state\.status === ['"]delivered['"]\) clearCompletedCheckout\(\)/);
    assert.match(client, /function clearCompletedCheckout\(\)[\s\S]*clearStoredCheckout\(\)/);
    assert.match(client, /async function maybeRestoreReturn\(\)[\s\S]*const restoredOrderNo = state\.orderNo[\s\S]*state\.orderNo !== restoredOrderNo/);
    assert.match(client, /restoredOrder\.payment_status[\s\S]*restoredOrder\.fulfillment_status[\s\S]*clearCompletedCheckout\(\)/);
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

test('confirmed payments poll fulfilment faster while unpaid orders keep the normal interval', () => {
    assert.match(client, /const POLL_INTERVAL_MS = 3500/);
    assert.match(client, /const CONFIRMED_FULFILLMENT_POLL_INTERVAL_MS = 1000/);
    assert.match(client, /calculateSmartPollInterval/);
    assert.match(
        client,
        /if \(state\.smartPollingEnabled\)[\s\S]*calculateSmartPollInterval/
    );
    assert.match(client, /window\.setTimeout\(run, nextPollIntervalMs\)/);
    // A failed/transient status request falls back to the ordinary interval;
    // it must not create a tight retry loop or a second modal flow.
    assert.match(client, /let nextPollIntervalMs = POLL_INTERVAL_MS/);

    const intervals = parseSmartPollIntervals(client);
    const statusLimitPerMinute = parseStatusRateLimitPerMinute(guestShopHandler);
    const confirmedStates = [
        'FULFILLING',
        'PAYMENT_JUST_CONFIRMED',
        'PAYMENT_CONFIRMED_EARLY',
        'PAYMENT_CONFIRMED_LATE'
    ];
    for (const key of confirmedStates) {
        assert.ok(Number.isFinite(intervals[key]), `${key} interval must exist`);
        // One buyer must fit inside the shared per-IP status budget while polling
        // the confirmed window.  Exceeding it turns delivery into 429s plus the
        // 3.5s error retry, which is slower than polling calmly.
        assert.ok(
            Math.ceil(60000 / intervals[key]) <= statusLimitPerMinute,
            `${key}=${intervals[key]}ms needs ${Math.ceil(60000 / intervals[key])}/min `
            + `but the status endpoint allows ${statusLimitPerMinute}/min per IP`
        );
        assert.ok(
            intervals[key] < intervals.AWAITING_PAYMENT,
            `${key} must poll faster than an unpaid order`
        );
    }
    assert.equal(intervals.AWAITING_PAYMENT, 3500);
    assert.ok(intervals.THROTTLED_HINT >= 5000, 'a backend throttle hint must back off to at least 5s');
    assert.ok(
        intervals.FULFILLING <= intervals.PAYMENT_CONFIRMED_LATE,
        'active fulfilment must not poll slower than the late confirmed window'
    );
});

test('terminal fulfilment failures stop tight polling and show an actionable state', () => {
    assert.match(
        client,
        /paymentStatus === ['"]confirmed['"] && fulfillmentStatus === ['"]paid_unfulfillable['"][\s\S]*正在处理退款或人工补发[\s\S]*shouldContinue = false/
    );
    assert.match(
        client,
        /paymentStatus === ['"]confirmed['"] && fulfillmentStatus === ['"]dead_letter['"][\s\S]*已转人工处理[\s\S]*shouldContinue = false/
    );
    assert.match(client, /fulfillmentStatus === ['"]failed['"][\s\S]*发货正在重试/);
    assert.match(client, /\['pending', 'fulfilling'\]\.includes\(fulfillmentStatus\)/);
});

test('manual status check forces a live provider query while background polling does not', () => {
    assert.match(client, /async function fetchStatus\(\{ forceRefresh = false \} = \{\}\)/);
    assert.match(client, /if \(forceRefresh\) query\.set\('force_provider_refresh', '1'\)/);
    assert.match(client, /async function pollStatus\(\{ immediate = false, resetWindow = false, forceProviderRefresh = false \} = \{\}\)/);
    assert.match(client, /let forceProviderRefreshNext = forceProviderRefresh === true/);
    assert.match(client, /fetchStatus\(\{ forceRefresh: forceProviderRefreshNext \}\)/);
    assert.match(client, /forceProviderRefreshNext = false/);
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
    assert.match(markup, /js\/guest-shop-client\.js\?v=20260917_GUEST_POLL_RATE_LIMIT_SAFE_1/);
    assert.match(
        markup,
        /js\/guest-shop-client\.js\?v=20260917_GUEST_POLL_RATE_LIMIT_SAFE_1&guestEntryMerge=20260917_GUEST_ENTRY_MERGE_1/
    );

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
    assert.match(markup, /js\/guest-shop-client\.js\?v=20260917_GUEST_POLL_RATE_LIMIT_SAFE_1/);
    assert.match(
        markup,
        /js\/guest-shop-client\.js\?v=20260917_GUEST_POLL_RATE_LIMIT_SAFE_1&guestEntryMerge=20260917_GUEST_ENTRY_MERGE_1/
    );

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
    assert.match(markup, /js\/guest-shop-client\.js\?v=20260917_GUEST_POLL_RATE_LIMIT_SAFE_1/);
    assert.match(
        markup,
        /js\/guest-shop-client\.js\?v=20260917_GUEST_POLL_RATE_LIMIT_SAFE_1&guestEntryMerge=20260917_GUEST_ENTRY_MERGE_1/
    );

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
