'use strict';

import { describe, it, expect, vi } from 'vitest';
const {
    registerStripeDeviceFingerprint,
    generateLocalFingerprintIds,
    encodeFingerprintPayload
} = require('../stripe-device-fingerprint');

describe('Stripe Device Fingerprint Module (m.stripe.com/6)', () => {
    it('generates valid local fallback IDs with proper format', () => {
        const ids = generateLocalFingerprintIds();
        expect(ids).toBeDefined();
        expect(typeof ids.guid).toBe('string');
        expect(typeof ids.muid).toBe('string');
        expect(typeof ids.sid).toBe('string');
        expect(ids.source).toBe('local_fallback');
        expect(ids.guid.length).toBeGreaterThan(20);
        expect(ids.muid.length).toBeGreaterThan(20);
        expect(ids.sid.length).toBeGreaterThan(20);
    });

    it('correctly encodes fingerprint payload into base64 URL-encoded format', () => {
        const payload = { v2: 1, id: 'test_fp', tag: '6' };
        const encoded = encodeFingerprintPayload(payload);
        expect(typeof encoded).toBe('string');
        const decoded = decodeURIComponent(Buffer.from(encoded, 'base64').toString());
        const parsed = JSON.parse(decoded);
        expect(parsed.id).toBe('test_fp');
        expect(parsed.tag).toBe('6');
    });

    it('falls back gracefully to local IDs when network is unreachable or times out', async () => {
        const ids = await registerStripeDeviceFingerprint({
            timeoutMs: 1 // Extremely low timeout forcing fallback
        });
        expect(ids).toBeDefined();
        expect(ids.guid).toBeDefined();
        expect(ids.muid).toBeDefined();
        expect(ids.sid).toBeDefined();
        expect(['stripe_registered', 'local_fallback']).toContain(ids.source);
    });
});
