const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('payments exception topics expose archived history and batch archive controls through delegated actions', () => {
    const adminPaymentsSource = readRepoFile('js/admin-payments.js');
    const adminStudioSource = readRepoFile('admin-studio.js');

    assert.match(adminPaymentsSource, /title: '已归档'/);
    assert.match(adminPaymentsSource, /data-admin-action="payments-batch-anomaly-action"/);
    assert.match(adminPaymentsSource, /function handleBatchAnomalyAction\(scope, action\)/);
    assert.match(adminPaymentsSource, /当前专题下暂无可归档的已处理项/);
    assert.match(adminStudioSource, /case 'payments-batch-anomaly-action':/);
    assert.match(adminStudioSource, /window\.AdminPayments\?\.handleBatchAnomalyAction/);
});
