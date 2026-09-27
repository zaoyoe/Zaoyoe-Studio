'use strict';

const crypto = require('node:crypto');

const KEY_ENV_NAME = 'GUEST_SHOP_CONTACT_EMAIL_ENCRYPTION_KEY';
const ENVELOPE_VERSION = 'v1';

function invalidKeyError() {
    const error = new Error('guest shop contact email encryption is not configured');
    error.statusCode = 503;
    error.code = 'guest_contact_storage_unavailable';
    error.expose = false;
    return error;
}

function getEncryptionKey(env = process.env) {
    const raw = String(env?.[KEY_ENV_NAME] || '').trim();
    if (!/^[0-9a-f]{64}$/iu.test(raw)) throw invalidKeyError();
    return Buffer.from(raw, 'hex');
}

function associatedData({ orderId, site }) {
    const normalizedOrderId = String(orderId || '').trim().toLowerCase();
    const normalizedSite = String(site || '').trim().toLowerCase();
    if (!normalizedOrderId || !['cn', 'intl'].includes(normalizedSite)) {
        throw new TypeError('invalid guest order contact binding');
    }
    return Buffer.from(`guest-shop-contact-email:${ENVELOPE_VERSION}:${normalizedSite}:${normalizedOrderId}`, 'utf8');
}

function encryptContactEmail(email, { orderId, site, env = process.env, randomBytes = crypto.randomBytes } = {}) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail || normalizedEmail.length > 320) throw new TypeError('invalid guest order contact email');
    const iv = randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(env), iv);
    cipher.setAAD(associatedData({ orderId, site }));
    const ciphertext = Buffer.concat([
        cipher.update(normalizedEmail, 'utf8'),
        cipher.final()
    ]);
    return [
        ENVELOPE_VERSION,
        iv.toString('base64url'),
        cipher.getAuthTag().toString('base64url'),
        ciphertext.toString('base64url')
    ].join('.');
}

function decryptContactEmail(envelope, { orderId, site, env = process.env } = {}) {
    const parts = String(envelope || '').split('.');
    if (parts.length !== 4 || parts[0] !== ENVELOPE_VERSION) return null;
    try {
        const iv = Buffer.from(parts[1], 'base64url');
        const tag = Buffer.from(parts[2], 'base64url');
        const ciphertext = Buffer.from(parts[3], 'base64url');
        if (iv.length !== 12 || tag.length !== 16 || ciphertext.length < 3 || ciphertext.length > 320) return null;
        const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(env), iv);
        decipher.setAAD(associatedData({ orderId, site }));
        decipher.setAuthTag(tag);
        const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(plaintext) || plaintext.length > 320) return null;
        return plaintext;
    } catch (_) {
        return null;
    }
}

module.exports = {
    KEY_ENV_NAME,
    decryptContactEmail,
    encryptContactEmail,
    getEncryptionKey
};
