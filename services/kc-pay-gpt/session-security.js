'use strict';

const crypto = require('crypto');

const ENCRYPTED_PREFIX = 'v1';
const SESSION_KEY_ENV_NAMES = ['KC_SESSION_ENCRYPTION_KEY', 'SESSION_ENCRYPTION_KEY'];

function resolveSessionEncryptionKey() {
    const configured = SESSION_KEY_ENV_NAMES
        .map((name) => String(process.env[name] || '').trim())
        .find(Boolean);
    if (!configured || Buffer.byteLength(configured, 'utf8') < 32) {
        throw new Error('未配置有效的 KC_SESSION_ENCRYPTION_KEY（至少 32 字节）；拒绝以明文保存 Session');
    }
    return crypto.createHash('sha256').update(configured, 'utf8').digest();
}

function encryptSessionPayload(value) {
    const plaintext = String(value || '');
    if (!plaintext) return null;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', resolveSessionEncryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [ENCRYPTED_PREFIX, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join(':');
}

function isEncryptedSessionPayload(value) {
    return String(value || '').startsWith(`${ENCRYPTED_PREFIX}:`);
}

function decryptSessionPayload(value) {
    const encoded = String(value || '');
    if (!encoded) return '';
    if (!isEncryptedSessionPayload(encoded)) {
        // Legacy rows remain readable only for controlled, authenticated operations.
        return encoded;
    }
    const parts = encoded.split(':');
    if (parts.length !== 4 || !parts[1] || !parts[2] || !parts[3]) {
        throw new Error('Session 加密数据格式无效');
    }
    try {
        const decipher = crypto.createDecipheriv(
            'aes-256-gcm',
            resolveSessionEncryptionKey(),
            Buffer.from(parts[1], 'base64url')
        );
        decipher.setAuthTag(Buffer.from(parts[2], 'base64url'));
        return Buffer.concat([
            decipher.update(Buffer.from(parts[3], 'base64url')),
            decipher.final()
        ]).toString('utf8');
    } catch (_) {
        throw new Error('Session 解密失败：密钥不匹配或数据已损坏');
    }
}

function fingerprintSessionPayload(value) {
    const plaintext = String(value || '').trim();
    return plaintext ? crypto.createHash('sha256').update(plaintext).digest('hex') : null;
}

function redactSensitiveText(value) {
    let text = String(value || '');
    if (!text) return text;

    text = text.replace(/(\b(?:authorization)\s*[:=]\s*)([^\r\n]+)/gi, '$1[REDACTED]');
    text = text.replace(/(\b(?:cookie|set-cookie)\s*[:=]\s*)([^\r\n]+)/gi, '$1[REDACTED]');
    text = text.replace(
        /(["']?(?:access[_-]?token|id[_-]?token|refresh[_-]?token|session[_-]?token|chatgpt_token|chatgpt_session_json)["']?\s*[:=]\s*["']?)([^\s,"'};]+(?:\s[^\n,"'}]*)?)/gi,
        '$1[REDACTED]'
    );
    text = text.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]');
    text = text.replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[JWT_REDACTED]');
    text = text.replace(/\b(?:\d[ -]*?){13,19}\b/g, '[CARD_REDACTED]');
    return text;
}

module.exports = {
    ENCRYPTED_PREFIX,
    resolveSessionEncryptionKey,
    encryptSessionPayload,
    decryptSessionPayload,
    isEncryptedSessionPayload,
    fingerprintSessionPayload,
    redactSensitiveText
};
