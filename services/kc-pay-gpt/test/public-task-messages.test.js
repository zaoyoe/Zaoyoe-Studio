import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import * as safety from '../task-safety.js';
import { formatTaskErrorMessage, publicTaskUpdate, GENERIC_FAILURE, AUTH_FAILURE, PAYMENT_UNCONFIRMED, CARD_DECLINED } from '../public/task-messages.js';

const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
function snippet(start, end) { return server.slice(server.indexOf(start), server.indexOf(end, server.indexOf(start))); }

describe('public task error boundary', () => {
    it.each([
        '定价弹窗未能成功弹出（页面停留在聊天首页，未展示 Plus/Pro 定价对话框）',
        'locator.click: timeout\nCall log: https://private.example.test/checkout?token=secret',
        'page.waitForFunction: Timeout 30000ms exceeded',
        '新版官方表单未就绪，尚未提交支付',
        '官方未接受当前账单地址，尚未提交支付 [GROK_TAX_ADDRESS_REFUSED]',
        '官方税费计算失败，尚未提交支付 [GROK_TAX_FAILED]',
        '官方税费计算仍未恢复，尚未提交支付 [GROK_TAX_RETRY_EXHAUSTED]',
        '税费重试上下文发生变化，已停止操作 [GROK_TAX_CONTEXT_CHANGED]',
        '数据库 unavailable: SELECT secret FROM accounts',
        'Error: Bearer secret-token'
    ])('never returns internal detail for %s', message => {
        for (const status of ['failed', 'manual']) expect(formatTaskErrorMessage(status, message)).toBe(GENERIC_FAILURE);
    });
    it.each(['Session 已失效或过期 [CHATGPT_SESSION_EXPIRED]', 'HTTP 401 [CHECKOUT_AUTH_ERROR]', 'token_expired', AUTH_FAILURE])('keeps credentials failures actionable and idempotent', message => {
        expect(formatTaskErrorMessage('failed', message)).toBe(AUTH_FAILURE);
        expect(formatTaskErrorMessage('failed', formatTaskErrorMessage('failed', message))).toBe(AUTH_FAILURE);
    });
    it('preserves the requested decline copy and strips the last four digits', () => {
        expect(formatTaskErrorMessage('manual', '支付卡被官方系统拒付 (尾号 ...2226) (Card Declined)')).toBe(CARD_DECLINED);
    });
    it.each(['started', 'unknown', 'succeeded'])('prioritizes actual payment activity %s over all failure reasons', paymentState => {
        for (const message of ['token_expired', 'card_declined', 'locator.click timeout']) {
            const result = formatTaskErrorMessage('manual', message, { paymentState });
            expect(result).toBe(PAYMENT_UNCONFIRMED);
            expect(result).not.toMatch(/未使用|回滚|已过期/);
        }
    });
    it('also preserves uncertainty for legacy messages without a payment-state field', () => {
        expect(formatTaskErrorMessage('manual', '支付结果未确认，已保留 CDK 与银行卡，需人工复核')).toBe(PAYMENT_UNCONFIRMED);
        expect(formatTaskErrorMessage('manual', 'token_expired', { recoveryRequired: true })).toBe(PAYMENT_UNCONFIRMED);
    });
    it('redacts progress and success messages while preserving state and CAPTCHA interactions', () => {
        expect(publicTaskUpdate({ type: 'progress', status: 'running', progress: 12, message: 'locator.click private' }))
            .toMatchObject({ progress: 12, message: '正在为您办理充值，请稍候' });
        expect(publicTaskUpdate({ type: 'status', status: 'success', message: 'private checkout URL' }).message).toBe('充值成功');
        const captcha = { type: 'captcha_interactive_required', message: '请选择图片' };
        expect(publicTaskUpdate(captcha)).toBe(captcha);
    });
    it('the browser uses exactly the same formatter as the server', () => {
        const sandbox = {};
        vm.runInNewContext(fs.readFileSync(new URL('../public/task-messages.js', import.meta.url), 'utf8'), sandbox);
        expect(sandbox.KcTaskMessages.formatTaskErrorMessage('failed', 'page.goto timeout')).toBe(GENERIC_FAILURE);
        const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
        expect(html).toContain('<script src="/task-messages.js"></script>');
        expect(html).toContain('formatTaskErrorMessage(status, message, data)');
    });
});

describe('actual server task delivery with a mock store', () => {
    it('filters live WebSocket failures before sending but leaves source diagnostics intact', () => {
        const send = vi.fn();
        const context = { taskClients: new Map([['offline-job', new Set([{ readyState: 1, send }])]]), WebSocket: { OPEN: 1 }, publicTaskUpdate };
        vm.runInNewContext(snippet('function broadcastToTask(', '// In-memory state for interactive'), context);
        const source = { type: 'status', status: 'failed', message: '定价弹窗未能成功弹出 private detail', progress: 20 };
        context.broadcastToTask('offline-job', source);
        expect(JSON.parse(send.mock.calls[0][0]).message).toBe(GENERIC_FAILURE);
        expect(source.message).toContain('定价弹窗');
    });
    it('filters reconnect snapshots loaded from historical raw task messages', async () => {
        const send = vi.fn();
        const task = { status: 'failed', message: '定价弹窗未能成功弹出', payment_state: 'not_started', recovery_required: 0, progress: 20 };
        const context = {
            store: { getTaskStatus: async () => task }, WebSocket: { OPEN: 1 }, publicTaskUpdate,
            TERMINAL_TASK_STATUSES: new Set(['failed', 'manual']), splitTaskMediaPaths: () => ({ screenshots: [], videos: [] }), extractTaskMediaFromOutput: () => ({ screenshots: [], videos: [] })
        };
        vm.runInNewContext(snippet('async function sendTaskSnapshot(', 'function logTask('), context);
        await context.sendTaskSnapshot({ readyState: 1, send }, 'offline-job');
        expect(JSON.parse(send.mock.calls[0][0]).message).toBe(GENERIC_FAILURE);
        task.status = 'manual'; task.payment_state = 'unknown'; task.recovery_required = 1; task.message = 'token_expired';
        await context.sendTaskSnapshot({ readyState: 1, send }, 'offline-job');
        expect(JSON.parse(send.mock.calls[1][0]).message).toBe(PAYMENT_UNCONFIRMED);
    });
    it('classifies the original 401 as a credentials failure without retrying or deleting cards', () => {
        const context = { ...safety };
        vm.runInNewContext(snippet('function extractRuntimeErrorMessage(', 'function getCheckoutProgress('), context);
        expect(context.analyzeProcessOutput('Session 登录成功\n❌ [运行时错误]: Checkout 创建接口返回 HTTP 401：token_expired [CHECKOUT_AUTH_ERROR]', false))
            .toMatchObject({ status: 'failed', shouldRetry: false, deleteCard: false, paymentState: 'not_started' });
        expect(context.analyzeProcessOutput('PAYMENT_STATE:unknown\n❌ [运行时错误]: token_expired [CHECKOUT_AUTH_ERROR]', false))
            .toMatchObject({ status: 'manual', recoveryRequired: true, paymentState: 'unknown' });
    });
    it.each(['配置套餐', '定价页', 'https://chatgpt.com/#pricing'])('does not treat %s as reaching payment', marker => {
        const context = { ...safety };
        vm.runInNewContext(snippet('function extractRuntimeErrorMessage(', 'function getCheckoutProgress('), context);
        expect(context.analyzeProcessOutput(marker, false)).toMatchObject({ reachedPayment: false });
    });
    it('all API checkout modes use the stop/fallback decision in the worker', () => {
        const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
        expect(source).toContain("if (!shouldFallbackToPricingCheckout(apiError, { checkoutMode, debugOnly: debugOnly && diagnosticMode === 'link' }))");
        expect(source).not.toContain("checkoutMode === 'api' && !shouldFallbackToPricingCheckout");
    });
});
