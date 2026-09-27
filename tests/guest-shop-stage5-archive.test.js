'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
    ARCHIVE_RECORD_ID,
    FORBIDDEN_ARCHIVE_KEYS,
    PRODUCT_ID,
    SKU_ID,
    archiveDigest,
    assertArchiveIsRedacted,
    buildStageFiveRollbackArchive,
    mergeStageFiveRollbackArchive
} = require('../scripts/guest-shop-stage5-archive');

const repoRoot = path.resolve(__dirname, '..');
const archiveDoc = fs.readFileSync(
    path.join(repoRoot, 'docs', 'guest-shop-stage5-rollback-archive.md'),
    'utf8'
);

test('Stage 5 archive is bound to the exact disabled product and SKU', () => {
    const archive = buildStageFiveRollbackArchive();

    assert.equal(archive.record_id, ARCHIVE_RECORD_ID);
    assert.equal(archive.status, 'complete');
    assert.equal(archive.environment, 'production');
    assert.equal(archive.scope.product_id, PRODUCT_ID);
    assert.equal(archive.scope.sku_id, SKU_ID);
    assert.equal(archive.scope.site, 'cn');
    assert.equal(archive.scope.quantity_cap, 1);
    assert.equal(archive.switch_transition.after, 'guest_purchase_disabled');
    assert.equal(archive.switch_transition.current_required_state, 'guest_purchase_disabled');
});

test('Stage 5 archive records the production rejection without overstating order effects', () => {
    const archive = buildStageFiveRollbackArchive();

    assert.equal(archive.evidence.source, 'operator_report');
    assert.equal(archive.evidence.observed_success, false);
    assert.equal(archive.evidence.observed_code, 'guest_product_unavailable');
    assert.equal(archive.evidence.sql_executed, false);
    assert.equal(archive.evidence.order_created, false);
    assert.equal(archive.evidence.payment_started, false);
    assert.match(archive.order_boundaries.historical_paid_orders, /not re-exercised/u);
    assert.match(archive.order_boundaries.existing_unpaid_orders, /not cancelled or paid/u);
    assert.match(archive.order_boundaries.new_guest_orders, /rejected before creation/u);
});

test('Stage 5 archive is deterministic and idempotent', () => {
    const first = buildStageFiveRollbackArchive();
    const second = buildStageFiveRollbackArchive();
    const merged = mergeStageFiveRollbackArchive(first, second);

    assert.deepEqual(first, second);
    assert.deepEqual(merged, first);
    assert.equal(archiveDigest(first), archiveDigest(second));
    assert.equal(archiveDigest(merged), archiveDigest(first));
});

test('Stage 5 archive rejects a conflicting duplicate record', () => {
    const first = buildStageFiveRollbackArchive();
    const conflict = structuredClone(first);
    conflict.switch_transition.after = 'guest_purchase_enabled';

    assert.throws(
        () => mergeStageFiveRollbackArchive(first, conflict),
        /idempotency conflict/u
    );
});

test('Stage 5 archive fails closed on sensitive fields and the checked-in document stays redacted', () => {
    const archive = buildStageFiveRollbackArchive();
    assert.doesNotThrow(() => assertArchiveIsRedacted(archive));

    for (const key of FORBIDDEN_ARCHIVE_KEYS) {
        assert.throws(
            () => assertArchiveIsRedacted({ ...archive, [key]: 'must-not-be-persisted' }),
            /Sensitive field is not allowed/u
        );
    }

    for (const key of ['orderPassword', 'claimToken', 'recoveryCode', 'cardSecret']) {
        assert.throws(
            () => assertArchiveIsRedacted({ ...archive, [key]: 'must-not-be-persisted' }),
            /Sensitive field is not allowed/u
        );
    }

    assert.match(archiveDoc, new RegExp(PRODUCT_ID, 'u'));
    assert.match(archiveDoc, new RegExp(SKU_ID, 'u'));
    assert.match(archiveDoc, /guest_product_unavailable/u);
    assert.match(archiveDoc, /保持 `guest_purchase_disabled`/u);
    assert.match(archiveDoc, /本归档不自动取消、不代用户支付/u);
    assert.match(archiveDoc, /部署成功、历史测试通过或本归档完成都不是重新启用授权/u);
    assert.doesNotMatch(archiveDoc, /GS\d{10,}/u, 'production order numbers must not be archived in plaintext');
    assert.doesNotMatch(archiveDoc, /[?&](?:token|secret|password)=/iu);
});
