const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const walletScriptPath = path.resolve(__dirname, '../js/components/WalletModal.js');
const walletStylesPath = path.resolve(__dirname, '../css/wallet.css');

test('wallet recharge UI exposes pending feedback hooks for package and custom recharge actions', () => {
    const script = fs.readFileSync(walletScriptPath, 'utf8');

    assert.match(script, /pendingRechargeAction:\s*null/);
    assert.match(script, /id="wallet-recharge-progress"/);
    assert.match(script, /setRechargeActionPendingState\(state = null\)/);
    assert.match(script, /buildRechargePendingMarkup\(label = '处理中'\)/);
    assert.match(script, /type="button" class="package-item"/);
    assert.match(script, /data-wallet-package-price/);
});

test('wallet recharge styles include visible processing states', () => {
    const styles = fs.readFileSync(walletStylesPath, 'utf8');

    assert.match(styles, /\.wallet-processing-banner\s*\{/);
    assert.match(styles, /\.wallet-overlay\.loading \.wallet-processing-banner\s*\{/);
    assert.match(styles, /\.package-item\.is-processing/);
    assert.match(styles, /\.package-item\.is-dimmed/);
    assert.match(styles, /\.custom-recharge-btn\.is-processing/);
    assert.match(styles, /@keyframes walletSpinnerRotate/);
});
