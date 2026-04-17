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
    assert.match(script, /buildRechargePendingMarkup\(label = '处理中'\)/);
    assert.match(script, /type="button" class="package-item"/);
    assert.match(script, /data-wallet-package-price/);
});

test('wallet recharge styles include visible processing states', () => {
    const styles = fs.readFileSync(walletStylesPath, 'utf8');

    assert.match(styles, /\.package-item\.is-processing/);
    assert.match(styles, /\.package-item\.is-dimmed/);
    assert.match(styles, /\.custom-recharge-btn\.is-processing/);
    assert.match(styles, /@keyframes walletSpinnerRotate/);
});

test('wallet payment order query section is driven by provider config instead of a hardcoded afdian-only branch', () => {
    const script = fs.readFileSync(walletScriptPath, 'utf8');

    assert.match(script, /order_query_enabled:\s*true/);
    assert.match(script, /order_query_title:\s*'订单号认领'/);
    assert.match(script, /const queryEnabled = activeProvider\?\.key === 'afdian'[\s\S]*activeProvider\?\.order_query_enabled === true/);
    assert.doesNotMatch(script, /const shouldShowAfdianQuery = activeProvider === 'afdian';/);
});
