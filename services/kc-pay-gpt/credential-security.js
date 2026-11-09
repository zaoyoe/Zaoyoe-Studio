'use strict';
const crypto = require('node:crypto');
const PREFIX = 'kc-secret:v1:';
const PURPOSES = new Set(['admin_totp_secret', 'admin_totp_pending']);
const KEY_ID = /^[a-zA-Z0-9_-]{1,32}$/;

function keyring(env) {
    let keys;
    try { keys = JSON.parse(env.KC_CREDENTIAL_KEYRING_JSON || '{}'); } catch (_) { throw new Error('KC credential keyring configuration invalid'); }
    if (!keys || typeof keys !== 'object' || Array.isArray(keys)) throw new Error('KC credential keyring configuration invalid');
    return keys;
}
function resolveKey(id, env) {
    if (!KEY_ID.test(id)) throw new Error('KC credential key id invalid');
    const encoded = keyring(env)[id];
    if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw new Error('KC credential encryption key unavailable');
    const key = Buffer.from(encoded, 'base64');
    if (key.length !== 32 || key.toString('base64') !== encoded) throw new Error('KC credential encryption key invalid');
    return key;
}
function aad(purpose, id) {
    if (!PURPOSES.has(purpose)) throw new Error('KC credential purpose invalid');
    return Buffer.from(`${PREFIX}${id}:${purpose}`, 'utf8');
}
function sealCredential(value, purpose, env = process.env) {
    if (typeof value !== 'string') throw new Error('KC credential value invalid');
    if (!value) return '';
    const id = String(env.KC_CREDENTIAL_ACTIVE_KEY_ID || '');
    const key = resolveKey(id, env);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(aad(purpose, id));
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return `${PREFIX}${id}:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ciphertext.toString('base64url')}`;
}
function openCredential(value, purpose, env = process.env) {
    aad(purpose, '');
    if (typeof value !== 'string') throw new Error('KC credential value invalid');
    if (!value) return '';
    if (!value.startsWith('kc-secret:')) {
        // Read compatibility only: old TOTP base32 values and pending JSON.
        if (purpose === 'admin_totp_secret' && /^[A-Z2-7]{16,128}$/.test(value)) return value;
        if (purpose === 'admin_totp_pending' && value.startsWith('{')) {
            try { const p = JSON.parse(value); if (p && /^[A-Z2-7]{16,128}$/.test(p.secret)) return value; } catch (_) { /* rejected below */ }
        }
        throw new Error('KC legacy credential format invalid');
    }
    const parts = value.split(':');
    if (parts.length !== 6 || !value.startsWith(PREFIX)) throw new Error('KC credential envelope invalid');
    const [, , id, ivText, tagText, dataText] = parts;
    const decode = (text, length) => {
        if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error('KC credential envelope invalid');
        const bytes = Buffer.from(text, 'base64url');
        if ((length && bytes.length !== length) || bytes.toString('base64url') !== text) throw new Error('KC credential envelope invalid');
        return bytes;
    };
    try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', resolveKey(id, env), decode(ivText, 12));
        decipher.setAAD(aad(purpose, id));
        decipher.setAuthTag(decode(tagText, 16));
        return Buffer.concat([decipher.update(decode(dataText)), decipher.final()]).toString('utf8');
    } catch (_) { throw new Error('KC credential decryption failed'); }
}
module.exports = { sealCredential, openCredential };
