#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');

const ARCHIVE_SCHEMA_VERSION = 1;
const ARCHIVE_RECORD_ID = 'guest-shop-stage5-rollback-2026-09-21-test-sku';
const PRODUCT_ID = '52246f1d-b98d-4920-9129-581296f43de9';
const SKU_ID = 'cc5d1ea9-83db-4c88-8fa8-fe7040c7c80d';

const FORBIDDEN_ARCHIVE_KEYS = Object.freeze([
    'email',
    'order_password',
    'password',
    'claim_token',
    'claim_secret',
    'claim_secret_hash',
    'recovery_code',
    'card_secret',
    'inventory_content',
    'checkout_url',
    'qr_code',
    'payment_key',
    'provider_secret',
    'raw_body',
    'response_payload'
]);

function normalizeArchiveKey(key) {
    return String(key || '').toLowerCase().replace(/[^a-z0-9]/gu, '');
}

const NORMALIZED_FORBIDDEN_ARCHIVE_KEYS = new Set(
    FORBIDDEN_ARCHIVE_KEYS.map(normalizeArchiveKey)
);

function stableClone(value) {
    if (Array.isArray(value)) return value.map(stableClone);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
        Object.keys(value)
            .sort()
            .map((key) => [key, stableClone(value[key])])
    );
}

function stableJson(value) {
    return JSON.stringify(stableClone(value));
}

function assertArchiveIsRedacted(value, path = 'archive') {
    if (Array.isArray(value)) {
        value.forEach((entry, index) => assertArchiveIsRedacted(entry, `${path}[${index}]`));
        return;
    }
    if (!value || typeof value !== 'object') return;

    for (const [key, child] of Object.entries(value)) {
        if (NORMALIZED_FORBIDDEN_ARCHIVE_KEYS.has(normalizeArchiveKey(key))) {
            throw new Error(`Sensitive field is not allowed in the operational archive: ${path}.${key}`);
        }
        assertArchiveIsRedacted(child, `${path}.${key}`);
    }
}

function buildStageFiveRollbackArchive() {
    const archive = {
        schema_version: ARCHIVE_SCHEMA_VERSION,
        record_id: ARCHIVE_RECORD_ID,
        archived_on: '2026-09-21',
        environment: 'production',
        status: 'complete',
        scope: {
            site: 'cn',
            product_id: PRODUCT_ID,
            product_name: '测试',
            sku_id: SKU_ID,
            sku_name: '默认规格',
            quantity_cap: 1,
            currency: 'CNY'
        },
        switch_transition: {
            before: 'guest_purchase_enabled',
            after: 'guest_purchase_disabled',
            current_required_state: 'guest_purchase_disabled'
        },
        evidence: {
            source: 'operator_report',
            operation: 'guest_product_preview_after_disable',
            observed_success: false,
            observed_code: 'guest_product_unavailable',
            observed_message: '商品暂不支持游客购买',
            sql_executed: false,
            order_created: false,
            payment_started: false,
            non_target_product_changed: false
        },
        order_boundaries: {
            historical_paid_orders: 'not_mutated_by_product_gate; continue fulfillment or refund through the existing runbook; not re-exercised by this rollback record',
            existing_unpaid_orders: 'not cancelled or paid by this rollback record; operator handles them through the existing runbook',
            new_guest_orders: 'rejected before creation while the exact product and SKU remain disabled'
        },
        ownership: {
            archive_owner: '商品开关负责人',
            payment_exception_owner: '支付/退款负责人',
            reenable_approver: '用户'
        },
        reenable_conditions: [
            'repeat the exact product/SKU review in Task 2.1 section 61.9.2',
            'confirm the production release and applicable runtime gates',
            'obtain explicit user approval before changing the product or SKU switch'
        ],
        audit: {
            idempotency_key: ARCHIVE_RECORD_ID,
            duplicate_policy: 'same idempotency key and same canonical payload returns the existing record; conflicting payload is rejected',
            sensitive_values_persisted: false
        }
    };

    assertArchiveIsRedacted(archive);
    return stableClone(archive);
}

function archiveDigest(archive) {
    assertArchiveIsRedacted(archive);
    return crypto.createHash('sha256').update(stableJson(archive), 'utf8').digest('hex');
}

function mergeStageFiveRollbackArchive(existing, incoming) {
    assertArchiveIsRedacted(existing);
    assertArchiveIsRedacted(incoming);

    if (!existing || !incoming || existing.record_id !== incoming.record_id) {
        throw new Error('Operational archive record_id mismatch');
    }
    if (archiveDigest(existing) !== archiveDigest(incoming)) {
        throw new Error('Operational archive idempotency conflict');
    }
    return stableClone(existing);
}

module.exports = {
    ARCHIVE_RECORD_ID,
    ARCHIVE_SCHEMA_VERSION,
    FORBIDDEN_ARCHIVE_KEYS,
    normalizeArchiveKey,
    PRODUCT_ID,
    SKU_ID,
    archiveDigest,
    assertArchiveIsRedacted,
    buildStageFiveRollbackArchive,
    mergeStageFiveRollbackArchive,
    stableJson
};
