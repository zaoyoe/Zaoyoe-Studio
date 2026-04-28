const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const walletScriptPath = path.resolve(__dirname, '../js/components/WalletModal.js');
const walletStylesPath = path.resolve(__dirname, '../css/wallet.css');

test('wallet recharge UI exposes pending feedback hooks for package and custom recharge actions', () => {
    const script = fs.readFileSync(walletScriptPath, 'utf8');

    assert.match(script, /pendingRechargeAction:\s*null/);
    assert.doesNotMatch(script, /id="wallet-recharge-progress"/);
    assert.match(script, /setRechargeActionPendingState\(state = null\)/);
    assert.match(script, /buildRechargePendingMarkup\(label = '处理中', options = \{\}\)/);
    assert.match(script, /wallet-pending-dots/);
    assert.match(script, /wallet-recharge-package-loading/);
    assert.match(script, /wallet-recharge-package-loading-dots/);
    assert.match(script, /dotsOnly/);
    assert.match(script, /type="button" class="package-item"/);
    assert.match(script, /data-wallet-package-price/);
    assert.match(script, /id="wallet-custom-recharge-subtitle" hidden/);
    assert.match(script, /id="wallet-custom-recharge-badge" hidden/);
    assert.match(script, /id="wallet-custom-recharge-meta" hidden/);
    assert.match(script, /placeholder="请输入充值金额"/);
    assert.match(script, />充值<\/button>/);
    assert.doesNotMatch(script, /前往\$\{providerLabel\}/);
    assert.doesNotMatch(script, /当前按 1 积分 = 1 元结算，支持 0\.01 精度/);
    assert.doesNotMatch(script, /按元测试换算成积分/);
    assert.match(script, /step="0\.01"/);
    assert.match(script, /inputmode="decimal"/);
    assert.match(script, /resolveCustomRechargeRequest\(rawValue, rechargeOptions = this\.rechargeOptionsConfig\)/);
    assert.match(script, /errorMessage: `请输入\$\{inputLabel\}`/);
    assert.match(script, /tryPresentHostedPaymentQrModal\(paymentResult,\s*\{/);
    assert.match(script, /startHostedPaymentQrPolling\(detailOverlay, paymentResult, options\)/);
    assert.match(script, /PointsService\.getPaymentRequestStatus\(/);
    assert.match(script, /qrcode_img_url/);
    assert.match(script, /qrcode_url/);
});

test('wallet mobile checkout uses same-tab redirect instead of popup-blocker error path', () => {
    const script = fs.readFileSync(walletScriptPath, 'utf8');

    assert.match(script, /openPaymentCheckoutUrl\(checkoutUrl, options = \{\}\)/);
    assert.match(script, /options\.sameTab === true \|\| this\.isMobilePaymentBrowser\(\)/);
    assert.match(script, /window\.location\.assign\(url\)/);
    assert.match(script, /this\.openPaymentCheckoutUrl\(paymentResult\.checkout_url\)/);
    assert.doesNotMatch(script, /支付页面被浏览器拦截，请允许弹窗后重试/);
});

test('wallet recharge styles include visible processing states', () => {
    const styles = fs.readFileSync(walletStylesPath, 'utf8');

    assert.match(styles, /\.package-item\.is-processing/);
    assert.match(styles, /\.package-item\.is-dimmed/);
    assert.match(styles, /\.custom-recharge-btn\.is-processing/);
    assert.match(styles, /\.wallet-pending-dots/);
    assert.match(styles, /\.wallet-recharge-package-loading/);
    assert.match(styles, /grid-column:\s*1 \/ -1/);
    assert.match(styles, /justify-content:\s*center/);
    assert.match(styles, /@keyframes walletPendingDots/);
    assert.doesNotMatch(styles, /@keyframes walletSpinnerRotate/);
    assert.match(styles, /\.wallet-payment-qr-modal/);
    assert.match(styles, /\.wallet-payment-qr-image/);
    assert.match(styles, /\.wallet-payment-qr-status/);
    assert.match(styles, /\.wallet-payment-qr-status\.is-success/);
});

test('wallet recharge scroll cue follows the active scroll host and hides after scrolling', () => {
    const script = fs.readFileSync(walletScriptPath, 'utf8');
    const styles = fs.readFileSync(walletStylesPath, 'utf8');

    assert.match(script, /function getWalletModalScrollElements\(\)/);
    assert.match(script, /function getWalletRechargeScrollCueScroller\(\)/);
    assert.match(script, /candidates\.find\(el => el\.scrollTop > 2\)/);
    assert.match(script, /const scrollHost = getWalletRechargeScrollCueScroller\(\)/);
    assert.match(script, /if \(overflowAmount < 8\)/);
    assert.match(script, /const nearTop = scrollHost\.scrollTop <= 2/);
    assert.match(script, /scrollElements\.forEach\(el => el\.addEventListener\('scroll', handleContentScroll, \{ passive: true \}\)\)/);
    assert.doesNotMatch(script, /!isRechargeActive \|\| !isCompactMobile/);

    assert.match(styles, /\.wallet-recharge-scroll-cue \{\s*display: flex;/);
    assert.match(styles, /@media \(min-width: 601px\)[\s\S]*\.wallet-recharge-scroll-cue \{[\s\S]*left: 160px;/);
});

test('wallet payment order query section is driven by provider config instead of a hardcoded afdian-only branch', () => {
    const script = fs.readFileSync(walletScriptPath, 'utf8');

    assert.match(script, /order_query_enabled:\s*true/);
    assert.match(script, /order_query_title:\s*'订单号认领'/);
    assert.match(script, /const queryEnabled = activeProvider\?\.key === 'afdian'[\s\S]*activeProvider\?\.order_query_enabled === true/);
    assert.match(script, /recoverPaymentConfigsFromSystemConfig\(\)/);
    assert.match(script, /loadSystemConfigValue\('payment_channels'\)/);
    assert.match(script, /loadSystemConfigValue\('recharge_options'\)/);
    assert.match(script, /id="wallet-order-query-section" hidden/);
    assert.match(script, /const customRechargeVisible = !document\.getElementById\('wallet-custom-recharge-section'\)\?\.hidden/);
    assert.match(script, /&& !customRechargeVisible/);
    assert.doesNotMatch(script, /const shouldShowAfdianQuery = activeProvider === 'afdian';/);
});
