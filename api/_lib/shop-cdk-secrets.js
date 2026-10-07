'use strict';

const crypto = require('node:crypto');

const ALGORITHM = 'aes-256-gcm';
const VERSION = 1;
const DEFAULT_MAX_LENGTH = 256;
const SERVICE_ROLE_ENV = 'SUPABASE_SERVICE_ROLE_KEY';

function readIndependentSecret(value, label, env = process.env) {
    const normalized = String(value || '').trim();
    if (!normalized) {
        throw new Error(`${label} 未配置，CDK 服务已拒绝继续处理`);
    }

    const serviceRole = String(env?.[SERVICE_ROLE_ENV] || '').trim();
    if (serviceRole && normalized === serviceRole) {
        throw new Error(`${label} 不能复用 SUPABASE_SERVICE_ROLE_KEY`);
    }

    return normalized;
}

function deriveKey(env = process.env) {
    const seed = readIndependentSecret(env?.SHOP_CDK_ENCRYPTION_KEY, 'SHOP_CDK_ENCRYPTION_KEY', env);
    return crypto.createHash('sha256').update(seed, 'utf8').digest();
}

function getHmacPepper(env = process.env) {
    return Buffer.from(readIndependentSecret(env?.SHOP_CDK_HMAC_PEPPER, 'SHOP_CDK_HMAC_PEPPER', env), 'utf8');
}

function normalizeCdk(value) {
    const normalized = String(value ?? '').trim();
    if (!normalized) {
        throw new Error('CDK 不能为空');
    }
    if (normalized.length < 6 || normalized.length > DEFAULT_MAX_LENGTH) {
        throw new Error('CDK 长度必须在 6 至 256 个字符之间');
    }
    if (/\s|[\u0000-\u001f\u007f]/u.test(normalized)) {
        throw new Error('CDK 不能包含空白或控制字符');
    }
    return normalized;
}

function fingerprintCdk(value, env = process.env) {
    const normalized = normalizeCdk(value);
    return crypto.createHmac('sha256', getHmacPepper(env))
        .update(normalized, 'utf8')
        .digest('hex');
}

function buildCdkAad({ inventoryId = '', site = 'cn' } = {}) {
    const normalizedInventoryId = String(inventoryId || '').trim();
    const normalizedSite = String(site || 'cn').trim().toLowerCase() || 'cn';
    if (!normalizedInventoryId) {
        throw new Error('CDK 加密上下文缺少库存 ID');
    }
    return Buffer.from(`kc-pay-gpt-cdk:v1|site=${normalizedSite}|inventory=${normalizedInventoryId}`, 'utf8');
}

function encryptCdk(value, { inventoryId, site = 'cn', env = process.env } = {}) {
    const normalized = normalizeCdk(value);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, deriveKey(env), iv);
    cipher.setAAD(buildCdkAad({ inventoryId, site }));
    const ciphertext = Buffer.concat([
        cipher.update(normalized, 'utf8'),
        cipher.final()
    ]);

    return {
        version: VERSION,
        algorithm: ALGORITHM,
        nonce: iv.toString('base64'),
        ciphertext: ciphertext.toString('base64'),
        auth_tag: cipher.getAuthTag().toString('base64'),
        fingerprint: fingerprintCdk(normalized, env)
    };
}

function decryptCdk(payload, { inventoryId, site = 'cn', env = process.env } = {}) {
    if (!payload || typeof payload !== 'object') {
        throw new Error('CDK 密文记录无效');
    }
    if (Number(payload.version || 0) !== VERSION || payload.algorithm !== ALGORITHM) {
        throw new Error('CDK 密文版本或算法不受支持');
    }

    try {
        const decipher = crypto.createDecipheriv(
            ALGORITHM,
            deriveKey(env),
            Buffer.from(String(payload.nonce || ''), 'base64')
        );
        decipher.setAAD(buildCdkAad({ inventoryId, site }));
        decipher.setAuthTag(Buffer.from(String(payload.auth_tag || payload.tag || ''), 'base64'));
        const plaintext = Buffer.concat([
            decipher.update(Buffer.from(String(payload.ciphertext || ''), 'base64')),
            decipher.final()
        ]).toString('utf8');
        return normalizeCdk(plaintext);
    } catch (error) {
        const safeError = new Error('CDK 解密失败，已拒绝交付');
        safeError.code = 'shop_cdk_decrypt_failed';
        safeError.cause = error;
        throw safeError;
    }
}

function isCdkInventoryType(value) {
    return String(value || '').trim().toLowerCase() === 'kc_pay_gpt_cdk';
}

module.exports = {
    ALGORITHM,
    VERSION,
    normalizeCdk,
    fingerprintCdk,
    buildCdkAad,
    encryptCdk,
    decryptCdk,
    isCdkInventoryType
};
