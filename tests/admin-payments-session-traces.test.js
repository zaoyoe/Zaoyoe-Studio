const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('payments ops workspace exposes checkout session traces', () => {
    const adminHtml = readRepoFile('admin-studio.html');
    const paymentsSource = readRepoFile('js/admin-payments.js');

    const htmlMarkers = [
        '最近支付意图会话',
        'id="paymentsCheckoutSessionsList"',
        'js/admin-payments.js?v=20260419_ADMIN_PAYMENTS_SESSION_TRACE_1'
    ];

    for (const marker of htmlMarkers) {
        assert.equal(adminHtml.includes(marker), true, `admin-studio.html should contain ${marker}`);
    }

    const runtimeMarkers = [
        'function renderCheckoutSessions(data) {',
        'recent_checkout_sessions',
        "paginateItems(sessions, 'sessions')",
        "document.getElementById('paymentsCheckoutSessionsList')",
        'getCheckoutSessionTraceDetail(session)'
    ];

    for (const marker of runtimeMarkers) {
        assert.equal(paymentsSource.includes(marker), true, `js/admin-payments.js should contain ${marker}`);
    }
});
