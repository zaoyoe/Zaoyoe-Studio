import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { chromium } from 'playwright';
import { observeClaudePayment, classifyClaudePaymentSnapshot, hasNewClaudeProEntitlement, waitForClaudePaymentOutcome } from '../claude-payment-observer.js';

let browser;
const contexts = [];
beforeAll(async () => { browser = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP * ~NOTFOUND'] }); });
afterEach(async () => { await Promise.all(contexts.splice(0).map(context => context.close())); });
afterAll(async () => { await browser?.close(); });
async function fixture(html = '<p>Processing</p>', path = '/upgrade/pro') {
    const context = await browser.newContext(); contexts.push(context);
    await context.route('**/*', route => route.request().isNavigationRequest()
        ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }) : route.abort());
    const page = await context.newPage(); await page.goto(`https://claude.ai${path}`); return page;
}
function options(page, overrides = {}) {
    return { observer: observeClaudePayment(page), beforeSubmit: { text: '' }, timeoutMs: 1200,
        hasCaptcha: vi.fn(async () => false), clearCaptcha: vi.fn(),
        checkInlineError: vi.fn(async () => ({ hasError: false })), screenshot: vi.fn(async () => null), ...overrides };
}
async function wait(page, config) {
    try { return await waitForClaudePaymentOutcome(page, config); }
    finally { config.observer.dispose(); }
}

describe('explicit Claude payment evidence', () => {
    it.each(['/new', '/chat', '/settings'])('does not claim success merely after leaving upgrade for %s', path => {
        expect(classifyClaudePaymentSnapshot({ url: `https://claude.ai${path}`, text: '' })).toMatchObject({ state: 'pending' });
    });
    it('does not accept a success-looking query on a different hostname', () => {
        expect(classifyClaudePaymentSnapshot({ url: 'https://example.test/?redirect_status=succeeded', text: '支付成功' })).toMatchObject({ state: 'pending' });
    });
    it('accepts an official successful redirect and explicit new success copy', () => {
        expect(classifyClaudePaymentSnapshot({ url: 'https://claude.ai/new?redirect_status=succeeded', text: '' })).toMatchObject({ state: 'succeeded' });
        expect(classifyClaudePaymentSnapshot({ url: 'https://claude.ai/upgrade/pro', text: 'Thank you for subscribing' })).toMatchObject({ state: 'succeeded' });
    });
    it('does not reuse an existing subscription badge as proof of a new payment', () => {
        expect(classifyClaudePaymentSnapshot({ url: 'https://claude.ai/upgrade/pro', text: 'Subscription is active' }, ['subscription is active'])).toMatchObject({ state: 'pending' });
    });
    it.each(['尚未支付成功', '如果支付成功', '支付成功后请刷新', 'No subscription active'])('does not interpret %s as a completed payment', text => {
        expect(classifyClaudePaymentSnapshot({ url: 'https://claude.ai/upgrade/pro', text })).toMatchObject({ state: 'pending' });
    });
    it('does not reuse a successful redirect query already present before the new submission', () => {
        const url = 'https://claude.ai/upgrade/pro?redirect_status=succeeded';
        expect(classifyClaudePaymentSnapshot({ url, text: '' }, [], '', url)).toMatchObject({ state: 'pending' });
    });
    it('treats login redirects and verification failure as unconfirmed', () => {
        expect(classifyClaudePaymentSnapshot({ url: 'https://claude.ai/login', text: '支付成功' })).toMatchObject({ state: 'unknown' });
        expect(classifyClaudePaymentSnapshot({ url: 'https://claude.ai/upgrade/pro', text: '安全验证未完成，因此您的购买未成功。您可以重试。' })).toMatchObject({ state: 'verification_failed' });
    });
    it('recognizes explicit official declines', () => {
        expect(classifyClaudePaymentSnapshot({ url: 'https://claude.ai/upgrade/pro', text: 'Your card was declined' })).toMatchObject({ state: 'declined' });
    });
    it('recognizes the official English purchase failure shown in the incident screenshot', () => {
        const text = 'This purchase cannot be completed.';
        expect(classifyClaudePaymentSnapshot({ url: 'https://claude.ai/upgrade/pro', text })).toMatchObject({ state: 'declined' });
        expect(classifyClaudePaymentSnapshot({ url: 'https://claude.ai/upgrade/pro', text }, [], 'This purchase cannot be completed'))
            .toMatchObject({ state: 'pending' });
        expect(classifyClaudePaymentSnapshot({ url: 'https://claude.ai/upgrade/pro', text: `${text} Unable to verify your browser` }))
            .toMatchObject({ state: 'verification_failed' });
    });
    it('only accepts new Pro entitlement for the same account and single organization', () => {
        const before = { accountId: 'fixture-account', orgId: 'fixture-org', organizationCount: 1, capabilities: [] };
        const after = { ...before, capabilities: ['claude_pro'] };
        expect(hasNewClaudeProEntitlement(before, after, 'claude_pro')).toBe(true);
        expect(hasNewClaudeProEntitlement(before, after, 'claude_pro_annual')).toBe(true);
        expect(hasNewClaudeProEntitlement(after, after, 'claude_pro')).toBe(false);
        expect(hasNewClaudeProEntitlement(before, { ...after, accountId: 'other' }, 'claude_pro')).toBe(false);
        expect(hasNewClaudeProEntitlement(before, { ...after, orgId: 'other' }, 'claude_pro')).toBe(false);
        expect(hasNewClaudeProEntitlement(before, { ...after, organizationCount: 2 }, 'claude_pro')).toBe(false);
        expect(hasNewClaudeProEntitlement(before, after, 'claude_max_5x')).toBe(false);
    });
});

describe('one Claude result wait', () => {
    it('detects same-page success without first waiting 45 seconds for a captcha', async () => {
        const page = await fixture();
        await page.evaluate(() => setTimeout(() => document.body.innerHTML = '<p>支付成功</p>', 80));
        const started = performance.now();
        expect(await wait(page, options(page))).toMatchObject({ success: true, submitted: true });
        expect(performance.now() - started).toBeLessThan(1000);
    });
    it('returns a confirmed decline immediately', async () => {
        const page = await fixture('<p>Your card was declined</p>');
        expect(await wait(page, options(page))).toMatchObject({ success: false, declined: true, canRetryCard: true });
    });
    it('does not reuse the previous card decline as evidence about a new submission', async () => {
        const page = await fixture('<p>Your card was declined</p>');
        expect(await wait(page, options(page, { beforeSubmit: { text: 'Your card was declined' }, timeoutMs: 100 })))
            .toMatchObject({ code: 'PAYMENT_RESULT_UNKNOWN' });
    });
    it('preserves an unknown timeout instead of authorizing another payment', async () => {
        const page = await fixture('<button onclick="window.payClicks++">Subscribe</button><script>window.payClicks=1</script>');
        expect(await wait(page, options(page, { timeoutMs: 100 }))).toMatchObject({ code: 'PAYMENT_RESULT_UNKNOWN', submissionAttempted: true });
        expect(await page.evaluate(() => window.payClicks)).toBe(1);
    });
    it('never resubmits when the page asks to retry verification', async () => {
        const page = await fixture('<p>安全验证未完成，因此您的购买未成功。您可以重试。</p><button onclick="window.clicked=true">Subscribe</button>');
        expect(await wait(page, options(page))).toMatchObject({ code: 'PAYMENT_RESULT_UNKNOWN', captchaRequired: true });
        expect(await page.evaluate(() => window.clicked)).toBeUndefined();
    });
    it('continues after the original human verification handler completes', async () => {
        const page = await fixture();
        const hasCaptcha = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false);
        const clearCaptcha = vi.fn(async () => { await page.setContent('<p>支付成功</p>'); return { cleared: true }; });
        expect(await wait(page, options(page, { hasCaptcha, clearCaptcha }))).toMatchObject({ success: true });
        expect(clearCaptcha).toHaveBeenCalledOnce();
    });
    it('returns the new official purchase failure after verification without waiting to timeout or submitting again', async () => {
        const page = await fixture();
        const hasCaptcha = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false);
        const clearCaptcha = vi.fn(async () => {
            await page.setContent('<p>This purchase cannot be completed.</p><button onclick="window.payClicks++">Subscribe</button><script>window.payClicks=1</script>');
            return { cleared: true };
        });
        const started = performance.now();
        expect(await wait(page, options(page, { hasCaptcha, clearCaptcha })))
            .toMatchObject({ success: false, declined: true, canRetryCard: true, submitted: true });
        expect(performance.now() - started).toBeLessThan(1000);
        expect(await page.evaluate(() => window.payClicks)).toBe(1);
        expect(clearCaptcha).toHaveBeenCalledOnce();
    });
    it('does not consume active payment waiting time while the user handles verification', async () => {
        const page = await fixture();
        const hasCaptcha = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false);
        const clearCaptcha = async () => {
            await page.waitForTimeout(200); await page.setContent('<p>支付成功</p>'); return { cleared: true };
        };
        expect(await wait(page, options(page, { hasCaptcha, clearCaptcha, timeoutMs: 100 }))).toMatchObject({ success: true });
    });
    it('preserves submission when verification cannot finish', async () => {
        const page = await fixture();
        expect(await wait(page, options(page, { hasCaptcha: async () => true, clearCaptcha: async () => ({ cleared: false }) })))
            .toMatchObject({ success: false, captchaRequired: true, code: 'PAYMENT_RESULT_UNKNOWN', submitted: true });
    });
    it('requires explicit entitlement evidence after a normal route redirect', async () => {
        const page = await fixture('<p>New conversation</p>', '/new');
        const confirmEntitlement = vi.fn(async () => true);
        expect(await wait(page, options(page, { confirmEntitlement }))).toMatchObject({ success: true });
        expect(confirmEntitlement).toHaveBeenCalledOnce();
    });
    it('does not treat field validation hints as a confirmed bank decline', async () => {
        const page = await fixture();
        expect(await wait(page, options(page, { checkInlineError: async () => ({ hasError: true }) })))
            .toMatchObject({ success: false, code: 'PAYMENT_RESULT_UNKNOWN' });
    });
    it('handles a closed page and cleans up listeners on every exit', async () => {
        const page = await fixture();
        const initial = page.listenerCount('response');
        const config = options(page); await page.close();
        expect(await wait(page, config)).toMatchObject({ code: 'PAYMENT_RESULT_UNKNOWN' });
        expect(page.listenerCount('response')).toBe(initial);
    });
    it('wakes on frame events and disposes an outstanding wait', async () => {
        const page = await fixture();
        const observer = observeClaudePayment(page);
        const pending = observer.wait(10000);
        page.emit('frameattached', page.mainFrame());
        await pending;
        const next = observer.wait(10000); observer.dispose(); await next;
        expect(page.listenerCount('frameattached')).toBe(0);
    });
});
