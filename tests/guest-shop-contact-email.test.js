'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    decryptContactEmail,
    encryptContactEmail,
    getEncryptionKey
} = require('../api/_lib/guest-shop/contact-email');

const KEY = 'a1'.repeat(32);
const ENV = { GUEST_SHOP_CONTACT_EMAIL_ENCRYPTION_KEY: KEY };
const BINDING = { orderId: '33333333-3333-4333-8333-333333333333', site: 'cn', env: ENV };

test('contact email encryption round-trips with a fresh authenticated envelope', () => {
    const first = encryptContactEmail('Buyer@Example.com', BINDING);
    const second = encryptContactEmail('Buyer@Example.com', BINDING);

    assert.equal(decryptContactEmail(first, BINDING), 'buyer@example.com');
    assert.notEqual(first, second, 'each encryption should use a fresh IV');
    assert.equal(first.startsWith('v1.'), true);
    assert.equal(first.includes('buyer@example.com'), false);
});

test('contact email ciphertext is bound to both order and site and rejects tampering', () => {
    const encrypted = encryptContactEmail('buyer@example.com', BINDING);

    assert.equal(decryptContactEmail(encrypted, { ...BINDING, orderId: '44444444-4444-4444-8444-444444444444' }), null);
    assert.equal(decryptContactEmail(encrypted, { ...BINDING, site: 'intl' }), null);
    const parts = encrypted.split('.');
    parts[3] = `${parts[3][0] === 'A' ? 'B' : 'A'}${parts[3].slice(1)}`;
    assert.equal(decryptContactEmail(parts.join('.'), BINDING), null);
    assert.equal(decryptContactEmail(encrypted, { ...BINDING, env: { GUEST_SHOP_CONTACT_EMAIL_ENCRYPTION_KEY: 'b2'.repeat(32) } }), null);
});

test('contact email encryption requires an independent 32-byte hexadecimal key', () => {
    assert.equal(getEncryptionKey(ENV).length, 32);
    assert.throws(() => getEncryptionKey({}), { code: 'guest_contact_storage_unavailable' });
    assert.throws(() => getEncryptionKey({ GUEST_SHOP_CONTACT_EMAIL_ENCRYPTION_KEY: 'short' }), { code: 'guest_contact_storage_unavailable' });
});
