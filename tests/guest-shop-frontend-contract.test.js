'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// Order Access 2.0 (A2): the browser generator is judged against the REAL
// server policy, not against a copy of it, so a drift in either side fails here.
const security = require('../api/_lib/guest-shop/security');

const repoRoot = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const markup = read('shop.html');
const client = read('js/guest-shop-client.js');
const styles = read('css/shop-page.css');
const guestShopHandler = read('server/api-handlers/public/guest-shop.js');
// A2 deliverables: the standalone lookup page and the shared password module.
const ordersPage = read('guest-orders.html');
const ordersClient = read('js/guest-orders-client.js');
const ordersStyles = read('css/guest-orders.css');
const passwordModuleSource = read('js/guest-query-password.js');

/**
 * Comments are prose; code is the contract. The guest scripts legitimately
 * document WHY supabase / Authorization / localStorage.setItem are forbidden,
 * so the isolation assertions below run against comment-stripped source and
 * fail on a real reference only. Same helper convention as
 * tests/guest-shop-buyer-credentials.test.js: block comments and whole-line
 * comments go, trailing `// ...` on a code line stays so a URL inside a string
 * literal is never mangled.
 */
function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//gu, ' ')
        .replace(/^[ \t]*\/\/.*$/gmu, '');
}

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

// ---------------------------------------------------------------------------
// Order Access 2.0 (A2) — query password collection, generator and lookup page
// ---------------------------------------------------------------------------

test('the shared query-password module is CSPRNG-only, storage-free and network-free', () => {
    const code = stripComments(passwordModuleSource);
    assert.match(code, /getRandomValues/);
    assert.doesNotMatch(code, /Math\.random/);
    assert.doesNotMatch(code, /localStorage|sessionStorage|document\.cookie/);
    assert.doesNotMatch(code, /fetch\s*\(|XMLHttpRequest|sendBeacon/);
    assert.doesNotMatch(code, /supabase|access_token|Authorization\s*:|Bearer/i);
    assert.doesNotMatch(code, /innerHTML/);
    assert.doesNotMatch(code, /X-Guest-Claim-Secret|claimSecret|claim_secret/);
    // Unbiased rejection sampling. A plain `buffer[0] % max` would over-represent
    // the first alphabet characters and quietly narrow the effective keyspace of
    // every generated query password.
    assert.match(code, /Math\.floor\(0x100000000 \/ max\) \* max/);
    assert.match(code, /globalThis\.GuestQueryPassword = Object\.freeze\(\{/);
    // The module must stay a pure companion to the generator button: it never
    // sees an order, a credential or a recovery code.
    assert.doesNotMatch(code, /order_no|orderNo|recovery/i);
});

test('the browser query-password generator only mints passwords the real server policy accepts', () => {
    // Deterministic xorshift32 so a policy regression reproduces exactly instead
    // of flaking. In the browser the module uses crypto.getRandomValues; here we
    // only need a stable, unbiased enough byte source to exercise the alphabet.
    let seed = 0x2545f491;
    const nextUint32 = () => {
        seed ^= seed << 13; seed >>>= 0;
        seed ^= seed >>> 17;
        seed ^= seed << 5; seed >>>= 0;
        return seed;
    };
    const context = vm.createContext({
        crypto: {
            getRandomValues(buffer) {
                for (let index = 0; index < buffer.length; index += 1) buffer[index] = nextUint32();
                return buffer;
            }
        }
    });
    vm.runInContext(passwordModuleSource, context, { filename: 'js/guest-query-password.js' });
    const api = context.GuestQueryPassword;
    assert.ok(api, 'the module must expose globalThis.GuestQueryPassword');

    // Frozen parity with the server. These three values are the whole reason the
    // button exists: if the alphabet, the length or the minimum drift, every
    // "帮我生成" password becomes a guaranteed 400 guest_password_weak and the
    // buyer is told the password WE minted is too weak.
    assert.deepEqual(
        { ...api.CLASSES },
        { ...security._private.GENERATED_QUERY_PASSWORD_CLASSES },
        'the browser alphabet must mirror GENERATED_QUERY_PASSWORD_CLASSES character-for-character'
    );
    assert.equal(api.GENERATED_LENGTH, security.GENERATED_QUERY_PASSWORD_LENGTH);
    assert.equal(api.MIN_LENGTH, security.GUEST_QUERY_PASSWORD_MIN_LENGTH);

    const alphabet = new Set(Object.values(security._private.GENERATED_QUERY_PASSWORD_CLASSES).join(''));
    const SAMPLES = 20000;
    const seen = new Set();
    let denylistHits = 0;
    for (let index = 0; index < SAMPLES; index += 1) {
        const candidate = api.generate();
        assert.equal([...candidate].length, api.GENERATED_LENGTH);
        for (const ch of candidate) {
            assert.equal(alphabet.has(ch), true, `${candidate} contains an out-of-alphabet character`);
        }
        assert.equal(seen.has(candidate), false, 'generated passwords must not repeat');
        seen.add(candidate);

        const result = security.validateGuestQueryPasswordPolicy(candidate);
        if (result.ok) continue;
        // P7a is the ONE rule the browser deliberately does not mirror: shipping
        // the ~120-entry server denylist to the client would leak a policy asset
        // to save a round trip, and a random 12-character string collides with
        // it at roughly 1/200k. The client turns that residual into a re-mint +
        // re-copy (asserted below), never a dead end, so it is tolerated here but
        // bounded. Any other rule means the local structural mirror drifted.
        assert.equal(
            result.rule,
            'P7a',
            `${candidate} was rejected by ${result.rule}, which js/guest-query-password.js must mirror`
        );
        denylistHits += 1;
    }
    assert.ok(
        denylistHits / SAMPLES < 0.001,
        `P7a residual rate ${denylistHits}/${SAMPLES} is far above the ~1/200k expectation`
    );

    // The live checklist (§11.3) and the submit gate must agree with the server's
    // P1/P2a-P2d on the same input, otherwise the modal shows five green ticks
    // for a password the server is about to refuse.
    for (const probe of [api.generate(), 'Ab3!xY9#', 'short1!', 'alllowercase1!', 'NOUPPERCASE!']) {
        const inspected = api.inspect(probe);
        const server = security.validateGuestQueryPasswordPolicy(probe);
        const clientOk = api.policyFailure(probe) === null;
        // P6-P8/P10 inputs the client cannot judge are allowed to differ, but the
        // four-class + length verdict surfaced in the UI must match exactly.
        assert.equal(
            inspected.length,
            [...probe].length >= security.GUEST_QUERY_PASSWORD_MIN_LENGTH,
            `length tick disagrees for ${probe}`
        );
        assert.equal(inspected.upper, /[A-Z]/.test(probe));
        assert.equal(inspected.lower, /[a-z]/.test(probe));
        assert.equal(inspected.digit, /[0-9]/.test(probe));
        assert.equal(inspected.punct, /[^A-Za-z0-9]/.test(probe));
        assert.equal(inspected.ok, inspected.length && inspected.upper && inspected.lower && inspected.digit && inspected.punct);
        if (server.ok) assert.equal(clientOk, true, `client rejected a password the server accepts: ${probe}`);
        if (!server.ok && ['P1', 'P2a', 'P2b', 'P2c', 'P2d'].includes(server.rule)) {
            assert.equal(clientOk, false, `client accepted a password the server rejects with ${server.rule}: ${probe}`);
        }
    }

    // §6.1.2 step 2: fullwidth folding must be identical on both sides, or a
    // Chinese IME turns a working credential into a permanent 403.
    assert.equal(
        api.foldFullwidth('Ａｂ３！'),
        security._private.foldFullwidthAscii('Ａｂ３！')
    );
    assert.equal(api.foldFullwidth('Ab3!xY9#'), 'Ab3!xY9#');
});

test('the shop modal collects the query password only when the server says it is required', () => {
    // Markup: the whole block ships hidden, so with GUEST_SHOP_BUYER_CREDENTIAL_ENABLED
    // off the checkout a buyer sees is byte-identical to today (D1).
    assert.match(markup, /id="guestCashOrderPasswordField"[^>]*hidden/);
    assert.match(
        markup,
        /id="guestCashOrderPassword"[^>]*type="password"[^>]*autocomplete="new-password"[^>]*maxlength="64"[^>]*spellcheck="false"/
    );
    // new-password, never current-password: this field MINTS a secret, and
    // current-password makes browsers offer a reused site password (§8.3).
    assert.doesNotMatch(markup, /id="guestCashOrderPassword"[^>]*autocomplete="current-password"/);
    assert.match(markup, /id="guestCashOrderPasswordChecks"[^>]*class="guest-shop-modal__pw-checks"/);
    for (const key of ['length', 'upper', 'lower', 'digit', 'punct']) {
        assert.match(markup, new RegExp(`<li data-pw-check="${key}">`), `missing checklist item ${key}`);
    }
    assert.match(markup, /id="guestCashOrderPasswordNote"[^>]*role="status"[^>]*hidden/);
    assert.match(markup, /id="guestCashToggleOrderPasswordBtn"[^>]*aria-pressed="false"/);
    assert.match(markup, /id="guestCashGenerateOrderPasswordBtn"[^>]*>帮我生成</);
    assert.match(markup, /id="guestCashOrdersPageLink"[^>]*href="\/guest-orders\.html"[^>]*hidden/);
    assert.match(styles, /\.guest-shop-modal__pw-checks/);
    assert.match(styles, /\.guest-shop-modal__pw-btn/);
    assert.match(styles, /\.guest-shop-modal__pw-note/);

    // The generator module must be mounted BEFORE the client that calls into it,
    // and both carry the A2 cachebuster.
    const generatorIndex = markup.indexOf('js/guest-query-password.js');
    const guestClientIndex = markup.indexOf('js/guest-shop-client.js');
    assert.ok(generatorIndex >= 0, 'js/guest-query-password.js must be mounted');
    assert.ok(guestClientIndex > generatorIndex, 'the generator must load before the guest client');
    assert.match(markup, /js\/guest-query-password\.js\?v=20260921_GUEST_ORDER_ACCESS_A2_1/);
    assert.match(markup, /guestOrderAccess=20260921_GUEST_ORDER_ACCESS_A2_1/);

    // Client: the switch is driven ONLY by the server's preview flag, never by a
    // client-side guess, so the server stays authoritative (§6.1.4).
    assert.match(client, /buyerCredentialRequired:\s*false,/);
    assert.match(client, /state\.buyerCredentialRequired = preview\?\.buyer_credential_required === true;/);
    assert.match(client, /setHidden\('guestCashOrderPasswordField', !required\);/);
    assert.match(client, /setHidden\('guestCashOrdersPageLink', !required\);/);
    assert.match(client, /setText\('guestCashContactHint', required \? '必填，用于查询订单与获取发货通知' : '可选'\);/);
    // Off path must actively wipe any plaintext left in the field.
    assert.match(client, /if \(!required\) clearOrderPassword\(\);/);

    // maxlength=64 is the server's P3 cap; folding slices to the same bound.
    assert.match(client, /return folded\.slice\(0, 64\);/);
    // The frozen normalization contract NEVER trims a query password. A trim
    // here but not on the lookup page would strand an order behind one space.
    const foldStart = client.indexOf('function foldQueryPassword(value)');
    const foldEnd = client.indexOf('\n    function setOrderPasswordNote', foldStart);
    assert.ok(foldStart > 0 && foldEnd > foldStart, 'foldQueryPassword must stay a standalone function');
    assert.doesNotMatch(client.slice(foldStart, foldEnd), /\.trim\(/);
});

test('the query password travels once in the order body and is never persisted, URL-encoded or silently retried', () => {
    // Mandatory email + client-side strength gate before the request is built.
    assert.match(client, /if \(state\.buyerCredentialRequired\) \{[\s\S]*?if \(!email\) \{[\s\S]*?请填写邮箱，用于查询订单与获取发货通知/);
    assert.match(client, /const passwordFailure = orderPasswordPolicyFailure\(\);[\s\S]*?setStateMessage\(orderPasswordPolicyMessage\(passwordFailure\), 'error'\);\s*return;/);
    assert.match(client, /if \(orderPassword\) body\.orderPassword = orderPassword;/);
    // Fixed quantity 1 is unchanged by A2 — the credential must not become a
    // back door into multi-quantity guest orders.
    assert.match(client, /const body = \{[\s\S]*quantity:\s*1,[\s\S]*idempotencyKey:/);

    // Never persisted: the checkout snapshot keeps order_no + expiry only.
    const persistStart = client.indexOf('function persistCheckout()');
    const persistEnd = client.indexOf('\n    function hydrateCheckout', persistStart);
    assert.ok(persistStart > 0 && persistEnd > persistStart, 'persistCheckout must stay a standalone function');
    const persisted = client.slice(persistStart, persistEnd);
    assert.doesNotMatch(persisted, /orderPassword|queryPassword|generatedOrderPassword/i);
    assert.doesNotMatch(persisted, /password/i);

    // Plaintext is dropped on success BEFORE the snapshot is written, and on
    // modal close, so it never outlives the request that needed it.
    assert.match(client, /clearOrderPassword\(\);\s*\n\s*persistCheckout\(\);/);
    const closeStart = client.indexOf('function closeGuestModal(');
    assert.ok(closeStart > 0, 'closeGuestModal must exist');
    assert.match(client.slice(closeStart, closeStart + 2000), /clearOrderPassword\(\);/);

    // A server-side rejection must re-mint and ask the buyer to click again.
    // Auto-resubmitting would loop against the order-creation rate limit and
    // could mint a second credential group behind the buyer's back.
    assert.match(client, /if \(error\?\.code === 'guest_password_weak'\) void refreshRejectedOrderPassword\(\);/);
    const refreshStart = client.indexOf('async function refreshRejectedOrderPassword()');
    const refreshEnd = client.indexOf('\n    function toggleOrderPasswordVisibility', refreshStart);
    assert.ok(refreshStart > 0 && refreshEnd > refreshStart, 'refreshRejectedOrderPassword must stay a standalone function');
    const refreshBody = client.slice(refreshStart, refreshEnd);
    assert.doesNotMatch(refreshBody, /createOrder|ORDER_ENDPOINT|requestJson|fetch\s*\(/);
    assert.match(refreshBody, /请点击「帮我生成」换一个/);
    assert.match(refreshBody, /请妥善保存后再次点击「创建订单」/);
    // A password the buyer typed by hand is NEVER replaced without asking.
    assert.match(refreshBody, /if \(!current \|\| current !== state\.generatedOrderPassword\) \{/);
});

test('the guest order lookup page is a lean standalone page with no account runtime', () => {
    assert.match(ordersPage, /<meta name="robots" content="noindex, nofollow">/);
    assert.match(ordersPage, /<body class="guest-orders-page">/);
    assert.match(ordersPage, /css\/guest-orders\.css\?v=20260922_GUEST_ORDER_ACCESS_A3_1/);
    for (const id of [
        'guestOrdersSavedHint', 'guestOrdersSavedEmail', 'guestOrdersClearSavedBtn',
        'guestOrdersQueryForm', 'guestOrdersEmail', 'guestOrdersPassword',
        'guestOrdersTogglePasswordBtn', 'guestOrdersOrderNo', 'guestOrdersSubmitBtn',
        'guestOrdersError', 'guestOrdersLoading', 'guestOrdersResultCard',
        'guestOrdersEmpty', 'guestOrdersList', 'guestOrdersPagination',
        'guestOrdersPageInfo', 'guestOrdersPrevBtn', 'guestOrdersNextBtn',
        'guestOrdersDetail', 'guestOrdersDetailRows', 'guestOrdersDeliveryContent',
        'guestOrdersCopyDeliveryBtn', 'guestOrdersLoadDeliveryBtn',
        'guestOrdersLegacyOrderNo', 'guestOrdersLegacyCode', 'guestOrdersLegacyBtn',
        // A3 §10.5 one-time reset-link card
        'guestOrdersResetCard', 'guestOrdersResetForm', 'guestOrdersResetEmail',
        'guestOrdersResetPassword', 'guestOrdersResetPasswordConfirm',
        'guestOrdersResetToggleBtn', 'guestOrdersResetGenerateBtn',
        'guestOrdersResetPolicy', 'guestOrdersResetSubmitBtn',
        // A3 §13.2 historical-order self-upgrade
        'guestOrdersUpgradeEmail', 'guestOrdersUpgradePassword',
        'guestOrdersUpgradePasswordConfirm', 'guestOrdersUpgradeToggleBtn',
        'guestOrdersUpgradeGenerateBtn', 'guestOrdersUpgradePolicy',
        'guestOrdersUpgradeBtn', 'guestOrdersUpgradeResult'
    ]) {
        assert.match(ordersPage, new RegExp(`id="${id}"`), `guest-orders.html is missing #${id}`);
    }
    // The lookup field LOOKS UP an existing secret, so current-password is the
    // correct (and opposite) choice to the order form's new-password.
    assert.match(ordersPage, /id="guestOrdersPassword"[\s\S]{0,120}autocomplete="current-password"[^>]*maxlength="64"/);
    assert.match(ordersPage, /id="guestOrdersEmail"[^>]*type="email"/);
    assert.match(ordersPage, /id="guestOrdersQueryForm"[^>]*novalidate/);

    // A3: the two credential-MINTING forms must ask a password manager for a NEW
    // password (the opposite of the lookup field), and the reset card must start
    // hidden — it is revealed only after the client has read a real ?reset= token,
    // so a hand-typed /guest-orders.html?reset=xxx cannot pre-open a form.
    assert.match(ordersPage, /id="guestOrdersResetCard"[^>]*hidden/);
    assert.match(ordersPage, /id="guestOrdersResetPassword"[\s\S]{0,200}autocomplete="new-password"/);
    assert.match(ordersPage, /id="guestOrdersUpgradePassword"[\s\S]{0,200}autocomplete="new-password"/);
    assert.doesNotMatch(ordersPage, /id="guestOrdersReset[^>]*autocomplete="current-password"/);
    assert.doesNotMatch(ordersPage, /id="guestOrdersUpgrade[^>]*autocomplete="current-password"/);
    // The page must not advertise the reset link as a self-service entry point:
    // it exists only in a support message from an admin (§10.5).
    assert.doesNotMatch(ordersPage, /href="[^"]*\?reset=/);

    // No account runtime at all: mounting shop-client would drag in supabase,
    // the wallet and the auth modal, which is exactly what the guest channel
    // must never touch.
    assert.doesNotMatch(ordersPage, /supabase/i);
    assert.doesNotMatch(ordersPage, /js\/shop-client\.js/);
    assert.doesNotMatch(ordersPage, /js\/guest-shop-client\.js/);
    assert.doesNotMatch(ordersPage, /chat-widget/);
    assert.doesNotMatch(ordersPage, /wallet-modal/);

    // Script order: site config, then the shared generator, then the page client.
    const siteConfig = ordersPage.indexOf('js/site-config.js');
    const generator = ordersPage.indexOf('js/guest-query-password.js');
    const pageClient = ordersPage.indexOf('js/guest-orders-client.js');
    assert.ok(siteConfig >= 0, 'site-config must be mounted');
    assert.ok(generator > siteConfig, 'the generator must load after site-config');
    assert.ok(pageClient > generator, 'the lookup client must load after the generator');
    assert.match(ordersPage, /js\/guest-orders-client\.js\?v=20260922_GUEST_ORDER_ACCESS_A3_1/);
    assert.doesNotMatch(ordersPage, /<script(?![^>]*\bdefer\b)[^>]*js\/guest-orders-client\.js/);
    assert.match(ordersStyles, /body\.guest-orders-page/);
    assert.match(ordersStyles, /\.guest-orders-item-discounts:empty/);
});

test('the lookup client stays isolated from the account auth system and never writes the query password to storage or a URL', () => {
    const code = stripComments(ordersClient);
    // Transport: the dedicated guest credential header, same-origin cookies only.
    assert.match(code, /const CREDENTIAL_HEADER = 'X-Guest-Order-Credential';/);
    assert.match(code, /credentials:\s*'same-origin'/);
    assert.match(code, /cache:\s*'no-store'/);
    assert.match(code, /sessionStorage/);
    assert.doesNotMatch(code, /supabase|access_token|Authorization\s*:|Bearer/i);
    // The lookup page must never see a one-time claim secret: delivery access is
    // credential-gated, and re-exposing claimSecret here would rebuild the exact
    // URL-leak surface the checkout client already removed.
    assert.doesNotMatch(code, /X-Guest-Claim-Secret|claimSecret|claim_secret/);
    assert.doesNotMatch(code, /Math\.random/);
    // Every order field is built with createElement/textContent: a product name
    // or delivery body is attacker-influenceable and must not become markup.
    assert.doesNotMatch(code, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/);

    // §7.2 storage ladder: memory -> sessionStorage -> a ONE-TIME localStorage
    // read + removeItem migration for credentials an older build left behind.
    // Writing to localStorage is forbidden because it survives across sessions
    // and browser profiles on a shared machine.
    assert.match(code, /window\.localStorage/);
    assert.match(code, /\.removeItem\(/);
    assert.doesNotMatch(code, /localStorage\s*\.\s*setItem/);
    assert.doesNotMatch(code, /localStorage\s*\[[^\]]*\]\s*=/);
    assert.doesNotMatch(code, /document\.cookie\s*=/);

    // Flat-key endpoints per the dispatcher contract (no path params), and the
    // credential never rides along in a query string.
    for (const endpoint of [
        "'/api/shop/guest/orders'",
        "'/api/shop/guest/order'",
        "'/api/shop/guest/delivery'",
        "'/api/shop/guest/access/login'",
        "'/api/shop/guest/access/logout'",
        // A3: the one-time reset link (§10.5) and the §13.2 historical-order
        // self-upgrade ride the same public flat-key dispatcher.
        "'/api/shop/guest/access/reset'",
        "'/api/shop/guest/access/upgrade'"
    ]) {
        assert.ok(code.includes(endpoint), `the lookup client must call ${endpoint}`);
    }
    assert.match(code, /searchParams\.set\('order_no', orderNo\)/);
    assert.doesNotMatch(code, /searchParams\.set\(\s*['"](?:password|orderPassword|credential|secret|token|email)/i);
    assert.doesNotMatch(code, /history\.(?:push|replace)State\([^)]*(?:password|credential|secret)/i);
    assert.doesNotMatch(code, /location\.(?:href|assign|replace)\s*=?\s*[^;]*(?:password|credential|secret)/i);

    // A3 §10.5: the one-time link token is a BEARER credential. It must be read
    // out of the address bar and deleted before any request, must never be put
    // back into a URL, and must never reach a storage tier.
    assert.match(code, /searchParams\.delete\('reset'\)/);
    assert.match(code, /history\.replaceState\(/);
    assert.doesNotMatch(code, /searchParams\.set\(\s*['"]reset['"]/);
    assert.doesNotMatch(code, /\?reset=/);
    assert.doesNotMatch(code, /resetToken\s*[:=][^;]*(sessionStorage|localStorage)/);
    // Both new surfaces send their secrets in the JSON body, under exactly one
    // canonical field spelling each, so the server cannot be probed with an
    // alternative normalization (§16.1).
    assert.match(code, /body: JSON\.stringify\(\{ token, email, password, site:/);
    assert.match(code, /body: JSON\.stringify\(\{ orderNo, recoveryCode, email, password, site:/);
    assert.doesNotMatch(code, /reset_token\s*:/);
    // K26 is mirrored locally through the shared module, never re-implemented
    // here, and never weakened by a Math.random generator.
    assert.match(code, /globalThis\.GuestQueryPassword/);
    assert.match(code, /policyFailure\(/);
    assert.match(code, /foldFullwidth\(/);
});
