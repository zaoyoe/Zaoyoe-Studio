import { describe, expect, it, vi } from 'vitest';
import { normalizeTaskLogText, buildAttemptDiagnostic, summarizeFailedAttempts, captureDiagnosticScreenshot, reportTaskFailure } from '../task-diagnostics.js';

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


describe('attempt diagnostics and settlement messages', () => {
    const failure = (attempt, message) => buildAttemptDiagnostic({ attempt, elapsedMs: 120.8, exitCode: 1,
        analysis: { status: 'retry', message, shouldRetry: true, paymentState: 'not_started' } });
    it('records only safe metadata and redacts before shortening the original cause', () => {
        const diagnostic = failure(1, 'HTTP 400 email=fixture@example.test cvv=123 ' +
            'Bearer fictional-token https://private-user:private-password@proxy.example ' +
            'PAYMENT_STATE:succeeded ' + '🙂'.repeat(800) + ' [CHECKOUT_UNUSUAL_ACTIVITY]');
        expect(diagnostic).toMatchObject({ attempt: 1, elapsedMs: 121, exitCode: 1, timedOut: false,
            status: 'retry', paymentState: 'not_started', shouldRetry: true, errorCode: 'CHECKOUT_UNUSUAL_ACTIVITY' });
        expect(Array.from(diagnostic.failure)).toHaveLength(700);
        expect(JSON.stringify(diagnostic)).not.toMatch(/fixture@|123|fictional-token|private-user|private-password|proxy\.example|PAYMENT_STATE/);
    });
    it('retains the first and last error codes within the existing message column', () => {
        const attempts = [failure(1, '创建收银台遭到拒绝🙂'.repeat(80) + ' [CHECKOUT_UNUSUAL_ACTIVITY]'),
            failure(2, '代理未确认目标地区🙂'.repeat(80) + ' [PROXY_PREFLIGHT_NETWORK]')];
        const summary = summarizeFailedAttempts(attempts, { status: 'failed', message: attempts[1].failure }, 'not_started');
        expect(summary).toContain('首次：[CHECKOUT_UNUSUAL_ACTIVITY]');
        expect(summary).toContain('最后（第2次）：[PROXY_PREFLIGHT_NETWORK]');
        expect(Array.from(summary).length).toBeLessThanOrEqual(255);
        expect(summary).not.toMatch(/[\uD800-\uDBFF]$/);
    });
    it.each(['started', 'unknown', 'succeeded'])('never overwrites a %s payment conclusion', paymentState => {
        const attempts = [failure(1, 'first'), failure(2, 'last')];
        expect(summarizeFailedAttempts(attempts, { status: 'failed', message: '保留资产，请勿重复充值' }, paymentState))
            .toBe('保留资产，请勿重复充值');
    });
    it.each(['success', 'manual'])('never overwrites %s status even if its payment field is absent', status => {
        expect(summarizeFailedAttempts([failure(1, 'first'), failure(2, 'last')], { status, message: '原始结论' }, 'not_started')).toBe('原始结论');
    });
    it('leaves a single refusal message intact', () => {
        const message = '请稍后再试 [CHECKOUT_UNUSUAL_ACTIVITY]';
        expect(summarizeFailedAttempts([failure(1, message)], { status: 'failed', message }, 'not_started')).toBe(message);
    });
});
