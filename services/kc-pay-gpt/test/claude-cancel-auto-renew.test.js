'use strict';

import { describe, it, expect, vi } from 'vitest';
const { cancelClaudeAutoRenew } = require('../claude-cancel-auto-renew');

describe('Claude Cancel Auto-Renew Module', () => {
    it('returns controlled error when page is invalid', async () => {
        const result = await cancelClaudeAutoRenew(null);
        expect(result).toMatchObject({
            ok: false,
            verificationUnknown: true
        });
        expect(result.error).toContain('缺少可用的 Claude 浏览器页面上下文');
    });

    it('cancels auto-renew successfully via Claude Web API', async () => {
        const mockPage = {
            evaluate: vi.fn().mockImplementation(async (fn, args) => {
                expect(args.orgId).toBe('org_test_123');
                return {
                    ok: true,
                    cancelled: true,
                    orgId: 'org_test_123',
                    message: '已成功关闭次月自动续订，本周期内 Pro 权益继续有效'
                };
            })
        };

        const result = await cancelClaudeAutoRenew(mockPage, {
            orgId: 'org_test_123'
        });

        expect(result.ok).toBe(true);
        expect(result.cancelled).toBe(true);
        expect(result.autoRenewRaw).toBe(false);
        expect(result.message).toContain('已成功关闭次月自动续订');
    });

    it('handles idempotent already-cancelled API response correctly', async () => {
        const mockPage = {
            evaluate: vi.fn().mockResolvedValue({
                ok: true,
                alreadyCancelled: true,
                orgId: 'org_test_123',
                message: '自动续费先前已关闭，下月不会自动扣款'
            })
        };

        const result = await cancelClaudeAutoRenew(mockPage, {
            orgId: 'org_test_123'
        });

        expect(result.ok).toBe(true);
        expect(result.alreadyCancelled).toBe(true);
        expect(result.autoRenewRaw).toBe(false);
    });

    it('falls back to billing UI when API cannot cancel directly', async () => {
        const mockPage = {
            evaluate: vi.fn().mockResolvedValue({
                ok: false,
                canFallbackUi: true
            }),
            goto: vi.fn().mockResolvedValue(null),
            waitForTimeout: vi.fn().mockResolvedValue(null),
            content: vi.fn().mockResolvedValue('<html><body>Subscription active</body></html>'),
            getByRole: vi.fn().mockImplementation((role, { name }) => {
                return {
                    first: () => ({
                        isVisible: vi.fn().mockResolvedValue(true),
                        click: vi.fn().mockResolvedValue(null)
                    })
                };
            })
        };

        const result = await cancelClaudeAutoRenew(mockPage, {
            orgId: 'org_test_123'
        });

        expect(mockPage.goto).toHaveBeenCalledWith('https://claude.ai/settings/billing', expect.any(Object));
        expect(result.ok).toBe(true);
        expect(result.cancelled).toBe(true);
        expect(result.message).toContain('已通过官方账单设置页面确认关闭次月自动续订');
    });

    it('safely handles UI exceptions without throwing fatal errors', async () => {
        const mockPage = {
            evaluate: vi.fn().mockResolvedValue({
                ok: false,
                canFallbackUi: true
            }),
            goto: vi.fn().mockRejectedValue(new Error('Navigation timeout')),
            waitForTimeout: vi.fn().mockResolvedValue(null)
        };

        const result = await cancelClaudeAutoRenew(mockPage, {
            orgId: 'org_test_123'
        });

        expect(result.ok).toBe(false);
        expect(result.verificationUnknown).toBe(true);
    });
});
