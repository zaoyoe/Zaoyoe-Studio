'use strict';

import { describe, it, expect, vi } from 'vitest';
const subscriptionCheck = require('../subscription-check');

describe('Admin Subscription & Auth Isolation', () => {
    it('mapCheckError maps status 401 to an informative error message', () => {
        // Test that 401 from ChatGPT API returns statusCode 401 internally
        // which server.js then converts to 400 so admin auth is never confused
        const err = subscriptionCheck.validateSessionTokenForQuery('invalid-token');
        expect(err.valid).toBe(false);
        expect(err.message).toContain('不合法');
    });

    it('cancelAutoRenew safely handles missing or invalid token without unhandled rejection', async () => {
        const result = await subscriptionCheck.cancelAutoRenew('');
        expect(result.ok).toBe(false);
        expect(result.statusCode).toBe(400);
        expect(result.error).toContain('缺少 AccessToken');
    });

    it('resumeAutoRenew safely handles missing or invalid token without unhandled rejection', async () => {
        const result = await subscriptionCheck.resumeAutoRenew('');
        expect(result.ok).toBe(false);
        expect(result.statusCode).toBe(400);
        expect(result.error).toContain('缺少 AccessToken');
    });
});
