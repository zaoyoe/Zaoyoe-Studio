import { describe, expect, it, vi } from 'vitest';
import { normalizeTaskLogText, captureDiagnosticScreenshot, reportTaskFailure } from '../task-diagnostics.js';

describe('failure diagnostics preserve original errors', () => {
    it('fits Unicode into the existing message column and retains full detail', () => {
        const message = '加载失败🙂'.repeat(80);
        const out = normalizeTaskLogText(message);
        expect(Array.from(out.message)).toHaveLength(255);
        expect(out.message.endsWith('…')).toBe(true);
        expect(out.message).not.toMatch(/[\uD800-\uDBFF]$/);
        expect(out.rawOutput).toBe(message);
    });
    it('redacts before retaining the detail and respects explicit raw output', () => {
        const out = normalizeTaskLogText('x'.repeat(300) + ' Bearer fictional-token', 'Bearer fictional-token');
        expect(out.rawOutput).not.toContain('fictional-token');
        expect(out.message).not.toContain('fictional-token');
        expect(normalizeTaskLogText('progress')).toEqual({ message: 'progress', rawOutput: null });
        expect(normalizeTaskLogText(null)).toEqual({ message: null, rawOutput: null });
        expect(normalizeTaskLogText('x'.repeat(255)).rawOutput).toBeNull();
    });
    it('still reports the original failure and releases resources after persistence fails', async () => {
        const events = [];
        const original = new Error('套餐加载失败');
        await reportTaskFailure({
            persist: async () => { events.push('persist'); throw new Error('storage unavailable'); },
            report: () => events.push(original.message),
            cleanup: () => events.push('cleanup'),
            onSecondaryError: (stage) => events.push(stage + ' failed')
        });
        expect(events).toEqual(['persist', 'persist failed', '套餐加载失败', 'cleanup']);
    });
    it('isolates failures in reporting, cleanup and secondary diagnostics', async () => {
        const cleanup = vi.fn(() => { throw new Error('cleanup'); });
        await expect(reportTaskFailure({
            persist: () => { throw new Error('persist'); },
            report: () => { throw new Error('report'); },
            cleanup,
            onSecondaryError: () => { throw new Error('diagnostics'); }
        })).resolves.toBeUndefined();
        expect(cleanup).toHaveBeenCalledOnce();
    });
    it('uses a bounded viewport screenshot and does not throw on capture failure', async () => {
        const screenshot = vi.fn().mockRejectedValue(new Error('fonts timeout'));
        const warn = vi.fn();
        await expect(captureDiagnosticScreenshot({ isClosed: () => false, screenshot }, '/tmp/offline.png', { warn })).resolves.toBeNull();
        expect(screenshot).toHaveBeenCalledWith({ path: '/tmp/offline.png', timeout: 4000, fullPage: false, animations: 'disabled' });
        expect(warn).toHaveBeenCalledOnce();
        await expect(captureDiagnosticScreenshot({ isClosed: () => true, screenshot }, '/tmp/offline.png')).resolves.toBeNull();
        expect(screenshot).toHaveBeenCalledOnce();
    });
    it('preserves the original failure when the screenshot warning logger also fails', async () => {
        const screenshot = vi.fn().mockRejectedValue(new Error('page closed'));
        const warn = vi.fn(() => { throw new Error('logger unavailable'); });
        await expect(captureDiagnosticScreenshot({ isClosed: () => false, screenshot }, '/tmp/offline.png', { warn })).resolves.toBeNull();
        expect(warn).toHaveBeenCalledOnce();
    });
    it('returns the saved screenshot path on success', async () => {
        const screenshot = vi.fn().mockResolvedValue(Buffer.from('test'));
        expect(await captureDiagnosticScreenshot({ isClosed: () => false, screenshot }, '/tmp/offline.png')).toBe('/tmp/offline.png');
    });
});
