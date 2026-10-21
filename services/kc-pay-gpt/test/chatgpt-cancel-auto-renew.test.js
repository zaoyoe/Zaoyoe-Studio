'use strict';

import { describe, it, expect, vi } from 'vitest';
const { cancelChatGptAutoRenew } = require('../chatgpt-cancel-auto-renew');

describe('ChatGPT Cancel Auto-Renew Module', () => {
    it('returns controlled error when page is invalid', async () => {
        const result = await cancelChatGptAutoRenew(null);
        expect(result).toMatchObject({
            ok: false,
            verificationUnknown: true
        });
        expect(result.error).toContain('缺少可用的 ChatGPT 浏览器页面上下文');
    });

    it('cancels auto-renew successfully via ChatGPT Web API', async () => {
        const mockPage = {
            evaluate: vi.fn().mockImplementation(async (fn, args) => {
                return {
                    ok: true,
                    cancelled: true,
                    message: '已成功关闭次月自动续订，本周期内 Plus 权益继续有效'
                };
            })
        };

        const result = await cancelChatGptAutoRenew(mockPage);

        expect(result.ok).toBe(true);
        expect(result.cancelled).toBe(true);
        expect(result.autoRenewRaw).toBe(false);
        expect(result.message).toContain('已成功关闭次月自动续订');
    });

    it('handles idempotent already-cancelled response correctly', async () => {
        const mockPage = {
            evaluate: vi.fn().mockResolvedValue({
                ok: true,
                alreadyCancelled: true,
                message: '自动续费先前已关闭，下月不会自动扣款'
            })
        };

        const result = await cancelChatGptAutoRenew(mockPage);

        expect(result.ok).toBe(true);
        expect(result.alreadyCancelled).toBe(true);
        expect(result.autoRenewRaw).toBe(false);
    });

    it('falls back to page UI when API cannot cancel directly', async () => {
        const mockPage = {
            url: () => 'https://chatgpt.com',
            content: vi.fn().mockResolvedValue('<div>Manage subscription: Cancel plan</div>'),
            goto: vi.fn().mockResolvedValue(null),
            waitForTimeout: vi.fn().mockResolvedValue(null),
            evaluate: vi.fn().mockResolvedValue({
                ok: false,
                canFallbackUi: true
            }),
            getByRole: vi.fn().mockImplementation((role, { name }) => ({
                first: () => ({
                    isVisible: vi.fn().mockResolvedValue(true),
                    click: vi.fn().mockResolvedValue(null)
                })
            }))
        };

        const result = await cancelChatGptAutoRenew(mockPage);
        expect(result.ok).toBe(true);
        expect(result.cancelled).toBe(true);
    });
});
