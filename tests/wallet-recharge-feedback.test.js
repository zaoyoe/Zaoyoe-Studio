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
    assert.match(script, /dotsOnly/);
    assert.match(script, /type="button" class="package-item"/);
    assert.match(script, /data-wallet-package-price/);
    assert.match(script, /id="wallet-custom-recharge-subtitle" hidden/);
    assert.match(script, /id="wallet-custom-recharge-meta" hidden/);
    assert.match(script, />充值<\/button>/);
    assert.doesNotMatch(script, /前往\$\{providerLabel\}/);
    assert.doesNotMatch(script, /当前按 1 积分 = 1 元结算，支持 0\.01 精度/);
    assert.doesNotMatch(script, /按元测试换算成积分/);
    assert.match(script, /step="0\.01"/);
    assert.match(script, /inputmode="decimal"/);
    assert.match(script, /resolveCustomRechargeRequest\(rawValue, rechargeOptions = this\.rechargeOptionsConfig\)/);
    assert.match(script, /tryPresentHostedPaymentQrModal\(paymentResult,\s*\{/);
    assert.match(script, /startHostedPaymentQrPolling\(detailOverlay, paymentResult, options\)/);
    assert.match(script, /PointsService\.getPaymentRequestStatus\(/);
    assert.match(script, /qrcode_img_url/);
    assert.match(script, /qrcode_url/);
});

test('wallet recharge styles include visible processing states', () => {
    const styles = fs.readFileSync(walletStylesPath, 'utf8');

    assert.match(styles, /\.package-item\.is-processing/);
    assert.match(styles, /\.package-item\.is-dimmed/);
    assert.match(styles, /\.custom-recharge-btn\.is-processing/);
    assert.match(styles, /\.wallet-pending-dots/);
    assert.match(styles, /@keyframes walletPendingDots/);
    assert.doesNotMatch(styles, /@keyframes walletSpinnerRotate/);
    assert.match(styles, /\.wallet-payment-qr-modal/);
    assert.match(styles, /\.wallet-payment-qr-image/);
    assert.match(styles, /\.wallet-payment-qr-status/);
    assert.match(styles, /\.wallet-payment-qr-status\.is-success/);
});

test('wallet payment order query section is driven by provider config instead of a hardcoded afdian-only branch', () => {
    const script = fs.readFileSync(walletScriptPath, 'utf8');

    assert.match(script, /order_query_enabled:\s*true/);
    assert.match(script, /order_query_title:\s*'订单号认领'/);
    assert.match(script, /const queryEnabled = activeProvider\?\.key === 'afdian'[\s\S]*activeProvider\?\.order_query_enabled === true/);
    assert.doesNotMatch(script, /const shouldShowAfdianQuery = activeProvider === 'afdian';/);
});
