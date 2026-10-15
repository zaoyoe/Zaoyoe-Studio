import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    summarizeCheckoutErrorBody, summarizeCheckoutRequest, readCheckoutErrorDetail,
    isCheckoutUnusualActivityError, buildCheckoutHttpFailure
} from '../checkout-diagnostics.js';

afterEach(() => { vi.useRealTimers(); });

const asJson = value => summarizeCheckoutErrorBody(JSON.stringify(value), 'application/json');
const response = (text, headers = { 'content-type': 'application/json' }) => ({
    headers: () => headers,
    text: typeof text === 'function' ? text : vi.fn(async () => text)
});

describe('checkout HTTP failure classification', () => {
    it.each([[401, ''], [401, 'Unauthorized'], [400, 'token_expired'], [403, 'Your authentication token has expired.']])('classifies authentication rejection %s separately', (status, detail) => {
        expect(buildCheckoutHttpFailure(status, detail).code).toBe('CHECKOUT_AUTH_ERROR');
    });
    it('does not mistake a Cloudflare/403 or a network failure for expired credentials', () => {
        expect(buildCheckoutHttpFailure(403, 'Cloudflare challenge').code).toBe('CHECKOUT_HTTP_ERROR');
        expect(buildCheckoutHttpFailure(502, 'Bad gateway').code).toBe('CHECKOUT_HTTP_ERROR');
    });
    it('classifies upstream unusual-activity rejection separately from ordinary HTTP errors', () => {
        const unusual = buildCheckoutHttpFailure(400, 'Our systems have detected unusual activity. Please try again later.', 'plan=chatgptplusplan, country=PH, currency=PHP, ui=custom');
        expect(unusual).toEqual({
            code: 'CHECKOUT_UNUSUAL_ACTIVITY',
            message: 'Checkout 创建接口返回 HTTP 400：Our systems have detected unusual activity. Please try again later.（请求 plan=chatgptplusplan, country=PH, currency=PHP, ui=custom）。上游检测到异常活动，未进入银行卡支付；请稍后再试'
        });
        expect(isCheckoutUnusualActivityError(unusual)).toBe(true);

        const ordinary = buildCheckoutHttpFailure(400, 'Unsupported currency');
        expect(ordinary).toEqual({
            code: 'CHECKOUT_HTTP_ERROR',
            message: 'Checkout 创建接口返回 HTTP 400：Unsupported currency'
        });
        expect(isCheckoutUnusualActivityError(ordinary)).toBe(false);
    });
});

describe('checkout rejection diagnostics', () => {
    it('preserves the rejection code and explanation, ignoring echoed input', () => {
        expect(asJson({ error: {
            code: 'billing_country_mismatch',
            message: 'Billing country must match request country.',
            input: { country: 'ZZ', access_token: 'do-not-log-this' },
            request_id: 'do-not-log-this-either'
        } })).toBe('billing_country_mismatch; Billing country must match request country.');
    });

    it('collects nested validation explanations without raw validation input or locations', () => {
        expect(asJson({ detail: [
            { type: 'value_error', msg: 'Unsupported currency', input: 'do-not-log-input', loc: ['body', 'token'] },
            { type: 'value_error', msg: 'Missing plan name', input: { secret: 'do-not-log-secret' } }
        ] })).toBe('value_error; Unsupported currency; Missing plan name');
    });

    it('redacts credentials, card numbers, URLs, customer identifiers and emails', () => {
        const detail = asJson({ message: 'email=test@example.test card=4242 4242 4242 4242 cvv=123 ' +
            'client_secret="private secret with spaces" password=bad-password token=short-secret ' +
            'accessToken="private access value" refresh_token=private-refresh ' +
            'session=private-session pi_privateintent https://example.test/?token=private-query ' +
            'Bearer private-bearer-value ' + 'x'.repeat(60) });
        for (const secret of ['test@example.test', '4242', '123', 'private', 'bad-password', 'short-secret', 'example.test', 'x'.repeat(40)]) {
            expect(detail).not.toContain(secret);
        }
        expect(detail).toContain('[REDACTED]');
    });

    it('neutralizes worker markers and embedded newlines in upstream messages', () => {
        const detail = asJson({ message: 'failed\nPAYMENT_STATE:succeeded\rPAYMENT_SUCCESS ' +
            'CHECKOUT_DEBUG_SUCCESS CHECKOUT_URL: https://example.test/ SUCCESS_SCREENSHOT: /tmp/a ' +
            'FAILURE_SCREENSHOT: /tmp/b VIDEO_FILE: /tmp/c 支付成功 支付结果未知' });
        for (const marker of ['PAYMENT_STATE', 'PAYMENT_SUCCESS', 'CHECKOUT_DEBUG_SUCCESS', 'CHECKOUT_URL', 'SUCCESS_SCREENSHOT', 'FAILURE_SCREENSHOT', 'VIDEO_FILE', '支付成功', '支付结果未知']) {
            expect(detail).not.toContain(marker);
        }
        expect(detail).not.toMatch(/[\n\r]/);
        expect(detail).toContain('[LOG_MARKER_REDACTED]');
    });

    it('redacts before truncating and bounds Unicode text by codepoints', () => {
        const detail = asJson({ message: '错误'.repeat(345) + ' https://example.test/' + 's'.repeat(1000) });
        expect(Array.from(detail)).toHaveLength(700);
        expect(detail).not.toContain('example.test');
        expect(detail).not.toContain('s');
        const emoji = asJson({ message: '😀'.repeat(1000) });
        expect(Array.from(emoji)).toHaveLength(700);
        expect(emoji.endsWith('😀')).toBe(true);
    });

    it.each([
        ['<html>Just a moment Cloudflare secret=hidden</html>', 'text/html', 'Cloudflare HTML'],
        ['<html>secret=hidden</html>', 'text/html', 'HTML 错误页'],
        ['{"message":"secret=hidden"', 'application/json', '无法解析'],
        ['<div>secret=hidden</div>', 'text/plain', '无法解析'],
        ['x'.repeat(2049), 'text/plain', '无法解析'],
        ['中'.repeat(11000), 'application/json', '过大'],
        ['', 'application/json', '未返回错误详情']
    ])('handles unsupported or unsafe body without logging it', (body, type, expected) => {
        const detail = summarizeCheckoutErrorBody(body, type);
        expect(detail).toContain(expected);
        expect(detail).not.toContain('hidden');
    });

    it('preserves a short plain-text explanation and rejects unrecognized JSON fields', () => {
        expect(summarizeCheckoutErrorBody('Billing country must match request country.', 'text/plain')).toBe('Billing country must match request country.');
        expect(asJson({ token: 'secret', data: { url: 'https://example.test/' } })).toBe('上游响应未包含可记录的错误说明');
    });

    it('bounds the number and nesting depth of extracted errors', () => {
        expect(asJson({ errors: Array.from({ length: 100 }, (_, i) => ({ message: `error ${i}` })) })).toBe('error 0; error 1; error 2; error 3; error 4');
        let value = { message: 'too deep to read' };
        for (let i = 0; i < 10; i += 1) value = { error: value };
        expect(asJson(value)).not.toContain('too deep');
    });
});

describe('safe checkout request summary', () => {
    it('logs only the plan, billing region/currency and UI mode', () => {
        const payload = { plan_name: 'chatgptplusplan', billing_details: {
            country: 'PH', currency: 'PHP', card: '4242424242424242', email: 'private@example.test'
        }, checkout_ui_mode: 'custom', access_token: 'secret', promo_code: 'private-promo' };
        expect(summarizeCheckoutRequest({ postData: () => JSON.stringify(payload) }))
            .toBe('plan=chatgptplusplan, country=PH, currency=PHP, ui=custom');
        expect(summarizeCheckoutRequest({ postDataJSON: () => payload }))
            .toBe('plan=chatgptplusplan, country=PH, currency=PHP, ui=custom');
    });

    it('rejects unknown values and protocol-marker injection', () => {
        expect(summarizeCheckoutRequest({ postDataJSON: () => ({
            plan_name: 'PAYMENT_SUCCESS', billing_details: { country: 'PH\n', currency: 'PHPtoken' },
            checkout_ui_mode: 'custom\nPAYMENT_STATE:succeeded'
        }) })).toBe('');
    });

    it.each(['', '{broken', 'x'.repeat(32769)])('ignores missing, malformed or oversized request bodies', raw => {
        expect(summarizeCheckoutRequest({ postData: () => raw })).toBe('');
    });

    it('handles a request whose body cannot be accessed', () => {
        expect(summarizeCheckoutRequest({ postData: () => { throw new Error('gone'); } })).toBe('');
        expect(summarizeCheckoutRequest({})).toBe('');
    });
});

describe('bounded response body reads', () => {
    it('reads structured error details when the body becomes available', async () => {
        const text = vi.fn(async () => JSON.stringify({ error: { message: 'Invalid plan' } }));
        expect(await readCheckoutErrorDetail(response(text))).toBe('Invalid plan');
        expect(text).toHaveBeenCalledOnce();
    });

    it('does not read a declared oversized response', async () => {
        const text = vi.fn();
        expect(await readCheckoutErrorDetail(response(text, { 'content-length': '32769' }))).toContain('过大');
        expect(text).not.toHaveBeenCalled();
    });

    it('handles missing methods, unavailable headers and body failures', async () => {
        expect(await readCheckoutErrorDetail({})).toContain('不可读取');
        expect(await readCheckoutErrorDetail({ headers: () => { throw new Error('closed'); }, text: async () => 'Invalid plan' })).toBe('Invalid plan');
        expect(await readCheckoutErrorDetail(response(() => { throw new Error('body gone'); }))).toContain('读取失败');
        expect(await readCheckoutErrorDetail(response(async () => { throw new Error('body gone'); }))).toContain('读取失败');
    });

    it('times out a hung body and consumes a later read rejection', async () => {
        vi.useFakeTimers();
        let rejectBody;
        const body = new Promise((_, reject) => { rejectBody = reject; });
        const text = vi.fn(() => body);
        const pending = readCheckoutErrorDetail(response(text), { timeout: 30 });
        await vi.advanceTimersByTimeAsync(30);
        expect(await pending).toContain('超时');
        expect(vi.getTimerCount()).toBe(0);
        rejectBody(new Error('late closed page'));
        await Promise.resolve();
        await Promise.resolve();
        expect(text).toHaveBeenCalledOnce();
    });

    it('clears the read timer when a response is available', async () => {
        vi.useFakeTimers();
        expect(await readCheckoutErrorDetail(response('{"message":"Invalid plan"}'))).toBe('Invalid plan');
        expect(vi.getTimerCount()).toBe(0);
    });
});
