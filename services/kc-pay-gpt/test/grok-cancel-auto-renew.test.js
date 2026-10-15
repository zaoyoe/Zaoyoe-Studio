'use strict';

import { describe, it, expect, vi } from 'vitest';
const { cancelGrokAutoRenew, formatTimestamp } = require('../grok-cancel-auto-renew');

describe('Grok Cancel Auto-Renew Module', () => {
    it('formats protobuf timestamp or ISO date string correctly', () => {
        expect(formatTimestamp(null)).toBe('');
        expect(formatTimestamp('')).toBe('');
        // Protobuf Timestamp: { seconds: '1794571200', nanos: 0 }
        const formatted = formatTimestamp({ seconds: 1794571200 });
        expect(formatted).toBeTruthy();
        expect(typeof formatted).toBe('string');
        // ISO string
        const formattedIso = formatTimestamp('2026-11-13T12:00:00Z');
        expect(formattedIso).toBeTruthy();
    });

    it('returns error when page is invalid', async () => {
        const result = await cancelGrokAutoRenew(null);
        expect(result).toMatchObject({
            ok: false,
            verificationUnknown: true
        });
        expect(result.error).toContain('缺少可用的 Grok 浏览器页面上下文');
    });

    it('cancels auto-renew successfully with direct subscriptionId', async () => {
        const mockPage = {
            evaluate: vi.fn().mockImplementation(async (fn, args) => {
                // 模拟在页面上下文中的执行
                expect(args.subId).toBe('sub_grok_active_123');
                return {
                    ok: true,
                    cancelled: true,
                    subscriptionId: 'sub_grok_active_123',
                    effectiveAt: { seconds: 1794571200, nanos: 0 },
                    message: '已成功关闭次月自动续订，本周期内权益继续有效'
                };
            })
        };

        const result = await cancelGrokAutoRenew(mockPage, {
            subscriptionId: 'sub_grok_active_123'
        });

        expect(result.ok).toBe(true);
        expect(result.cancelled).toBe(true);
        expect(result.alreadyCancelled).toBe(false);
        expect(result.autoRenewRaw).toBe(false);
        expect(result.subscriptionId).toBe('sub_grok_active_123');
        expect(result.message).toContain('已成功关闭次月自动续费');
    });

    it('discovers subscriptionId via GetSubscriptions and cancels when not initially provided', async () => {
        const mockPage = {
            evaluate: vi.fn().mockImplementation(async (fn, args) => {
                expect(args.subId).toBe('');
                return {
                    ok: true,
                    cancelled: true,
                    subscriptionId: 'sub_discovered_456',
                    effectiveAt: { seconds: 1794571200, nanos: 0 },
                    message: '已成功关闭次月自动续订，本周期内权益继续有效'
                };
            })
        };

        const result = await cancelGrokAutoRenew(mockPage, {});
        expect(result.ok).toBe(true);
        expect(result.cancelled).toBe(true);
        expect(result.subscriptionId).toBe('sub_discovered_456');
    });

    it('handles idempotent already-cancelled status as success', async () => {
        const mockPage = {
            evaluate: vi.fn().mockResolvedValue({
                ok: true,
                alreadyCancelled: true,
                subscriptionId: 'sub_grok_active_123',
                message: '自动续费先前已关闭，下月不会自动扣款'
            })
        };

        const result = await cancelGrokAutoRenew(mockPage, {
            subscriptionId: 'sub_grok_active_123'
        });

        expect(result.ok).toBe(true);
        expect(result.alreadyCancelled).toBe(true);
        expect(result.autoRenewRaw).toBe(false);
        expect(result.message).toContain('已关闭');
    });

    it('safely handles not-found subscriptions without throwing', async () => {
        const mockPage = {
            evaluate: vi.fn().mockResolvedValue({
                ok: false,
                notFound: true,
                error: '未能在官方账号下检索到活跃订阅 ID'
            })
        };

        const result = await cancelGrokAutoRenew(mockPage, {});
        expect(result.ok).toBe(false);
        expect(result.verificationUnknown).toBe(true);
        expect(result.error).toContain('未能在官方账号下检索到活跃订阅 ID');
    });

    it('safely catches page execution exceptions as verificationUnknown', async () => {
        const mockPage = {
            evaluate: vi.fn().mockRejectedValue(new Error('Target closed'))
        };

        const result = await cancelGrokAutoRenew(mockPage, { subscriptionId: 'sub_123' });
        expect(result.ok).toBe(false);
        expect(result.verificationUnknown).toBe(true);
        expect(result.error).toContain('Target closed');
    });
});
