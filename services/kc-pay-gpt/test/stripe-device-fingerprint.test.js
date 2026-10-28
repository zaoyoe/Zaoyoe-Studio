'use strict';

import { describe, it, expect, vi } from 'vitest';
const {
    registerStripeDeviceFingerprint,
    encodeFingerprintPayload
} = require('../stripe-device-fingerprint');

describe('Stripe Device Fingerprint Module (m.stripe.com/6)', () => {
    it('correctly encodes fingerprint payload into base64 URL-encoded format', () => {
        const payload = { v2: 1, id: 'test_fp', tag: '6' };
        const encoded = encodeFingerprintPayload(payload);
        expect(typeof encoded).toBe('string');
        const decoded = decodeURIComponent(Buffer.from(encoded, 'base64').toString());
        const parsed = JSON.parse(decoded);
        expect(parsed.id).toBe('test_fp');
        expect(parsed.tag).toBe('6');
    });

    it('accepts only a complete fingerprint response from the official endpoint', async () => {
        const request = vi.fn(async ({ url, body, headers }) => {
            expect(url).toBe('https://m.stripe.com/6');
            expect(body).toEqual(expect.any(String));
            expect(headers['Content-Type']).toBe('text/plain;charset=UTF-8');
            return {
                status: 200,
                data: {
                    guid: 'guid_registered_123',
                    muid: 'muid_registered_123',
                    sid: 'sid_registered_123'
                }
            };
        });

        const ids = await registerStripeDeviceFingerprint({
            request,
            clientSessionId: 'client-session-test'
        });

        expect(request).toHaveBeenCalledTimes(1);
        expect(ids).toMatchObject({
            guid: 'guid_registered_123',
            muid: 'muid_registered_123',
            sid: 'sid_registered_123',
            clientSessionId: 'client-session-test',
            source: 'stripe_registered'
        });
    });

    it('fails closed when the fingerprint request is unavailable', async () => {
        await expect(registerStripeDeviceFingerprint({
            request: vi.fn().mockRejectedValue(new Error('offline test'))
        })).rejects.toMatchObject({
            code: 'STRIPE_DEVICE_FINGERPRINT_UNAVAILABLE'
        });
    });

    it('fails closed when the official response is incomplete', async () => {
        await expect(registerStripeDeviceFingerprint({
            request: vi.fn().mockResolvedValue({
                status: 200,
                data: { guid: 'guid_registered_123', muid: 'muid_registered_123' }
            })
        })).rejects.toMatchObject({
            code: 'STRIPE_DEVICE_FINGERPRINT_UNAVAILABLE'
        });
    });

    it('fails closed when the official response contains only whitespace identifiers', async () => {
        await expect(registerStripeDeviceFingerprint({
            request: vi.fn().mockResolvedValue({
                status: 200,
                data: { guid: '  ', muid: 'muid_registered_123', sid: 'sid_registered_123' }
            })
        })).rejects.toMatchObject({
            code: 'STRIPE_DEVICE_FINGERPRINT_UNAVAILABLE'
        });
    });
});
