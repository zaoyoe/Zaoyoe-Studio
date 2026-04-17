const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('wallet checkin flow uses server linkage endpoint and refreshes coupon state', () => {
    const walletScript = readRepoFile('js/components/WalletModal.js');
    const smokeScript = readRepoFile('js/local-smoke-fixtures.js');

    const requiredWalletMarkers = [
        "fetch('/api/wallet/checkin'",
        'linked_discount_summary?.issued_count',
        'this.resetDiscountAssetsState();'
    ];

    for (const marker of requiredWalletMarkers) {
        assert.equal(walletScript.includes(marker), true, `WalletModal.js should contain ${marker}`);
    }

    const requiredSmokeMarkers = [
        "url.pathname === '/api/wallet/checkin'",
        "event_type: 'checkin'"
    ];

    for (const marker of requiredSmokeMarkers) {
        assert.equal(smokeScript.includes(marker), true, `local smoke fixtures should contain ${marker}`);
    }
});
