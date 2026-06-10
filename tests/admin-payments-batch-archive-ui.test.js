const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('payments exception topics and ops alerts expose batch controls through delegated actions', () => {
    const adminPaymentsSource = readRepoFile('js/admin-payments.js');
    const adminStudioSource = readRepoFile('admin-studio.js');
    const adminApiSource = readRepoFile('api/admin.js');
    const paymentsBatchActionsSource = readRepoFile('server/api-handlers/admin/payments/batch-actions.js');
    const adminStudioCss = readRepoFile('admin-studio.css');
    const adminStudioPageCss = readRepoFile('css/admin-studio-page.css');
    const batchLightStyle = adminStudioPageCss.slice(
        adminStudioPageCss.indexOf('html[data-theme="light"] #module-payments :is(.payments-batch-select span'),
        adminStudioPageCss.indexOf('/* 20260428_ADMIN_STUDIO_PAYMENTS_LIGHT_READABILITY_CLIP_FIX_1 */')
    );

    assert.match(adminPaymentsSource, /title: '已归档'/);
    assert.match(adminPaymentsSource, /data-admin-action="payments-batch-anomaly-action"/);
    assert.match(adminPaymentsSource, /data-payments-batch-apply-all="true"/);
    assert.match(adminPaymentsSource, /忽略当前 \$\{formatNumber\(quickIgnoreTargets\.length\)\} 条/);
    assert.match(adminPaymentsSource, /applyToAll = options\?\.applyToAll === true\s+&& normalizedScope === 'ops-alert-active'\s+&& normalizedAction === 'ignore'/);
    assert.match(adminPaymentsSource, /getBatchAnomalyTargets\(normalizedScope, normalizedAction, \{ applyToAll \}\)/);
    assert.match(adminPaymentsSource, /久远且不可追寻的历史告警/);
    assert.match(adminPaymentsSource, /data-admin-action="payments-toggle-batch-mode"/);
    assert.match(adminPaymentsSource, /data-admin-action="payments-toggle-batch-target"/);
    assert.match(adminPaymentsSource, /data-admin-action="payments-toggle-batch-scope"/);
    assert.match(adminPaymentsSource, /renderBatchActionToolbar\('exception-topic-active', activeItems\)/);
    assert.match(adminPaymentsSource, /renderBatchActionToolbar\('ops-alert-active', activeItems\)/);
    assert.match(adminPaymentsSource, /payments-batch-select\$\{selectionMode \? ' is-visible' : ''\}/);
    assert.match(adminPaymentsSource, /勾选批量处理/);
    assert.match(adminPaymentsSource, /const BATCH_PROCESS_ACTIONS = \['mark_handled', 'ignore', 'request_retry'\]/);
    assert.match(adminPaymentsSource, /function handleBatchAnomalyAction\(scope, action, options = \{\}\)/);
    assert.match(adminPaymentsSource, /function requestBatchAnomalyAction/);
    assert.match(adminPaymentsSource, /\/api\/admin\/payments\/batch-actions/);
    assert.match(adminPaymentsSource, /await requestBatchAnomalyAction\(\{/);
    assert.doesNotMatch(adminPaymentsSource, /Promise\.allSettled\(\s*targets\.map\(\(target\) => requestAnomalyAction/);
    assert.match(adminPaymentsSource, /function toggleBatchTarget\(scope = '', targetType = '', targetId = '', selected = false\)/);
    assert.match(adminPaymentsSource, /function toggleBatchScope\(scope = '', selected = false\)/);
    assert.match(adminPaymentsSource, /function setBatchSelectionMode\(scope = '', enabled = false\)/);
    assert.match(adminPaymentsSource, /function syncBatchSelectionDom\(scope = ''\)/);
    assert.match(adminPaymentsSource, /syncBatchSelectionDom\(normalizedScope\);/);
    assert.doesNotMatch(adminPaymentsSource, /function setBatchSelectionMode[\s\S]*?rerenderCurrentView\(\);[\s\S]*?function renderBatchItemSelector/);
    assert.match(adminPaymentsSource, /当前专题下暂无可归档的已处理项/);
    assert.match(adminStudioSource, /case 'payments-batch-anomaly-action':/);
    assert.match(adminStudioSource, /case 'payments-toggle-batch-mode':/);
    assert.match(adminStudioSource, /case 'payments-toggle-batch-target':/);
    assert.match(adminStudioSource, /case 'payments-toggle-batch-scope':/);
    assert.match(adminStudioSource, /window\.AdminPayments\?\.handleBatchAnomalyAction/);
    assert.match(adminStudioSource, /applyToAll: actionEl\.dataset\.paymentsBatchApplyAll === 'true'/);
    assert.match(adminStudioSource, /window\.AdminPayments\?\.setBatchSelectionMode/);
    assert.match(adminStudioSource, /window\.AdminPayments\?\.toggleBatchTarget/);
    assert.match(adminStudioSource, /window\.AdminPayments\?\.toggleBatchScope/);
    assert.match(adminApiSource, /paymentsBatchActionsHandler/);
    assert.match(adminApiSource, /'payments\/batch-actions': paymentsBatchActionsHandler/);
    assert.match(paymentsBatchActionsSource, /MAX_BATCH_TARGETS = 500/);
    assert.match(paymentsBatchActionsSource, /DEFAULT_BATCH_CONCURRENCY = 12/);
    assert.match(paymentsBatchActionsSource, /executePaymentAction/);
    assert.match(paymentsBatchActionsSource, /completed: failCount === 0/);
    assert.match(adminStudioCss, /\.payments-batch-toolbar/);
    assert.match(adminStudioCss, /\.payments-batch-toolbar--collapsed/);
    assert.match(adminStudioCss, /\.payments-batch-toolbar\.is-selection-mode/);
    assert.match(adminStudioCss, /\.payments-batch-select/);
    assert.match(adminStudioCss, /\.payments-batch-select:not\(\.is-visible\)/);
    assert.match(adminStudioCss, /flex: 1 1 auto/);
    assert.match(adminStudioCss, /color: var\(--admin-accent, #6b9ece\)/);
    assert.match(adminStudioCss, /color: inherit/);
    assert.match(adminStudioCss, /rgba\(var\(--admin-studio-ui-blue-rgb, 107, 158, 206\), 0\.18\)/);
    assert.match(adminStudioCss, /rgba\(107, 158, 206, 0\.24\)/);
    assert.match(adminStudioPageCss, /--payments-light-info-bg: rgba\(107, 158, 206, 0\.12\)/);
    assert.match(adminStudioPageCss, /--payments-light-info-border: rgba\(107, 158, 206, 0\.32\)/);
    assert.match(adminStudioPageCss, /--payments-light-info-text: var\(--admin-studio-ui-blue, #6b9ece\)/);
    assert.match(batchLightStyle, /background: var\(--payments-light-accent\) !important/);
    assert.match(batchLightStyle, /color: #ffffff !important/);
    assert.match(batchLightStyle, /-webkit-text-fill-color: #ffffff !important/);
    assert.match(batchLightStyle, /rgba\(var\(--payments-light-accent-rgb\), 0\.14\)/);
    assert.doesNotMatch(batchLightStyle, /34,\s*197,\s*94|16,\s*185,\s*129|#22c55e/i);
    assert.doesNotMatch(adminStudioPageCss, /--payments-light-info-text: #1d4ed8/);
});
