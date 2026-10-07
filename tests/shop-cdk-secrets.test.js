'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    encryptCdk,
    decryptCdk,
    fingerprintCdk,
    normalizeCdk,
    buildCdkAad,
    isCdkInventoryType
} = require('../api/_lib/shop-cdk-secrets');

const env = {
    SHOP_CDK_ENCRYPTION_KEY: 'test-only-cdk-encryption-key',
    SHOP_CDK_HMAC_PEPPER: 'test-only-cdk-hmac-pepper',
    SUPABASE_SERVICE_ROLE_KEY: 'a-different-service-role-key'
};

test('CDK encryption round-trips and binds ciphertext to inventory/site AAD', () => {
    const payload = encryptCdk('KC-TEST-001', {
        inventoryId: '8fb1f06f-22e0-4d1c-9eaf-4a1bdb3c3c01',
        site: 'cn',
        env
    });

    assert.equal(payload.algorithm, 'aes-256-gcm');
    assert.equal(payload.version, 1);
    assert.equal(decryptCdk(payload, {
        inventoryId: '8fb1f06f-22e0-4d1c-9eaf-4a1bdb3c3c01',
        site: 'cn',
        env
    }), 'KC-TEST-001');
    assert.throws(() => decryptCdk(payload, {
        inventoryId: '8fb1f06f-22e0-4d1c-9eaf-4a1bdb3c3c02',
        site: 'cn',
        env
    }), (error) => error.code === 'shop_cdk_decrypt_failed');
    assert.throws(() => decryptCdk(payload, {
        inventoryId: '8fb1f06f-22e0-4d1c-9eaf-4a1bdb3c3c01',
        site: 'intl',
        env
    }), (error) => error.code === 'shop_cdk_decrypt_failed');
});

test('CDK normalization rejects blank, whitespace and control characters', () => {
    assert.throws(() => normalizeCdk(''), /不能为空/);
    assert.throws(() => normalizeCdk('short'), /长度/);
    assert.throws(() => normalizeCdk('KC-TEST-01\nNEXT'), /空白或控制字符/);
    assert.equal(normalizeCdk('  KC-TEST-001  '), 'KC-TEST-001');
});

test('CDK fingerprint is deterministic but requires an independent HMAC pepper', () => {
    assert.equal(
        fingerprintCdk('KC-TEST-001', env),
        fingerprintCdk(' KC-TEST-001 ', env)
    );
    assert.throws(() => fingerprintCdk('KC-TEST-001', {
        ...env,
        SHOP_CDK_HMAC_PEPPER: env.SUPABASE_SERVICE_ROLE_KEY
    }), /不能复用 SUPABASE_SERVICE_ROLE_KEY/);
    assert.throws(() => encryptCdk('KC-TEST-001', {
        inventoryId: 'inventory-1',
        env: { ...env, SHOP_CDK_ENCRYPTION_KEY: '' }
    }), /SHOP_CDK_ENCRYPTION_KEY/);
});

test('CDK helpers expose explicit AAD and inventory type detection', () => {
    assert.equal(
        buildCdkAad({ inventoryId: 'inventory-1', site: 'cn' }).toString(),
        'kc-pay-gpt-cdk:v1|site=cn|inventory=inventory-1'
    );
    assert.equal(isCdkInventoryType('KC_PAY_GPT_CDK'), true);
    assert.equal(isCdkInventoryType('standard'), false);
});
