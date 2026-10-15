'use strict';

const axios = require('axios');
const client = require('../gpt-api-client');

describe('gpt api client', () => {
    afterEach(() => vi.restoreAllMocks());

    it('inspects the session before checkout using only documented fields', async () => {
        const spy = vi.spyOn(axios, 'request').mockResolvedValue({
            status: 200,
            data: { ok: true, verified: true, current_plan: 'Free' }
        });
        const out = await client.inspectPay(
            { base_url: 'https://example.test/api/v1', api_key: 'gptk_test' },
            { planKey: 'plus', session: { accessToken: 'token', user: { email: 'user@example.com' } } }
        );
        expect(out.success).toBe(true);
        expect(spy.mock.calls[0][0].url).toBe('https://example.test/api/v1/pay/inspect');
        expect(spy.mock.calls[0][0].data).toEqual({
            plan_key: 'plus',
            session: { accessToken: 'token', user: { email: 'user@example.com' } }
        });
    });

    it('preserves structured unverified reasons', async () => {
        vi.spyOn(axios, 'request').mockResolvedValue({
            status: 200,
            data: {
                ok: false,
                verified: false,
                error: 'session_unverified',
                reason: 'cloudflare_challenge',
                upstream_status: 403
            }
        });
        const out = await client.inspectPay(
            { base_url: 'https://example.test/api/v1', api_key: 'gptk_test' },
            { planKey: 'plus', sessionToken: 'token' }
        );
        expect(out).toMatchObject({
            success: false,
            error: 'session_unverified',
            reason: 'cloudflare_challenge',
            upstreamStatus: 403
        });
    });

    it('sends the protocol proxy field to pay', async () => {
        const spy = vi.spyOn(axios, 'request').mockResolvedValue({
            status: 200,
            data: { ok: true, order_id: 1, task_id: 2 }
        });
        await client.submitPay(
            { base_url: 'https://example.test/api/v1', api_key: 'gptk_test' },
            {
                planKey: 'plus',
                session: { accessToken: 'token', user: { email: 'user@example.com' } },
                newCard: { number: '4242', exp_month: 12, exp_year: 2030, cvc: '123' },
                proxy: 'http://8.8.8.8:8080',
                idempotencyKey: 'pay-1'
            }
        );
        expect(spy.mock.calls[0][0].data.proxy).toBe('http://8.8.8.8:8080');
        expect(spy.mock.calls[0][0].data.session.user.email).toBe('user@example.com');
    });
    it('parses the platform gpt plans array', async () => {
        vi.spyOn(axios, 'request').mockResolvedValue({ status: 200, data: { gpt: [{ key: 'plus' }], credit: [] } });
        const out = await client.fetchPlans({ base_url: 'https://example.test/api/v1', api_key: 'gptk_test' });
        expect(out.plans).toEqual([{ key: 'plus' }]);
    });

    it('uses the business result status instead of queue done', () => {
        expect(client.extractStatus({ status: 'done', result: { ok: false, status: 'failed', error: 'cf_challenge_unresolved' } })).toBe('failed');
        expect(client.extractStatus({ status: 'done', result: { ok: true, status: 'success' } })).toBe('success');
    });

    it('sends documented client reference and saved-card fields', async () => {
        const spy = vi.spyOn(axios, 'request').mockResolvedValue({
            status: 200,
            data: { ok: true, already_submitted: true, order_id: 12, task_id: 34, topup_code: 'code-prefix...' }
        });
        const out = await client.submitPay(
            { base_url: 'https://example.test/api/v1', api_key: 'gptk_test' },
            { planKey: 'plus', sessionToken: 'token', cardId: 8, cvc: '123', acceptWarnings: true, country: 'US', currency: 'USD', clientRef: 'kc-cdk-1', idempotencyKey: 'pay-1' }
        );
        expect(spy.mock.calls[0][0].data).toMatchObject({
            plan_key: 'plus', card_id: 8, cvc: '123', accept_warnings: true,
            country: 'US', currency: 'USD', client_ref: 'kc-cdk-1', session: { access_token: 'token' }
        });
        expect(out).toMatchObject({ orderId: 12, taskId: 34, alreadySubmitted: true, topupCode: 'code-prefix...' });
    });

    it('separates GPT and credit plans and summarizes balance', async () => {
        vi.spyOn(axios, 'request')
            .mockResolvedValueOnce({ status: 200, data: { gpt: [{ key: 'plus' }], credit: [{ id: 2, credits: 100 }] } })
            .mockResolvedValueOnce({ status: 200, data: { credits: 980, balance: 1250, balance_usd: '12.50' } });
        const plans = await client.fetchPlans({ base_url: 'https://example.test/api/v1', api_key: 'gptk_test' });
        const balance = await client.queryBalance({ base_url: 'https://example.test/api/v1', api_key: 'gptk_test' });
        expect(plans).toMatchObject({ gptPlans: [{ key: 'plus' }], creditPlans: [{ id: 2, credits: 100 }] });
        expect(balance).toMatchObject({ credits: 980, balance: 1250, balanceUsd: '12.50' });
    });

});

describe('GPT outsourcing transport safety', () => {
    const cfg = { base_url: 'https://provider.test/api/v1', api_key: 'gptk_private' };
    const pay = { planKey: 'plus', sessionToken: 'session-secret', newCard: { number: '4242424242424242',
        exp_month: 12, exp_year: 2030, cvc: '123' }, idempotencyKey: 'stable-business-1' };
    afterEach(() => vi.restoreAllMocks());

    it.each(['', 'https://provider.test', 'http://provider.test/api/v1',
        'https://user:secret@provider.test/api/v1', 'https://provider.test/api/v1?key=secret',
        'https://provider.test/api/v1#secret'])('rejects unsafe or incomplete endpoints before HTTP: %s', async base_url => {
        const spy = vi.spyOn(axios, 'request');
        expect(await client.request('GET', '/plans', { ...cfg, base_url })).toMatchObject({
            success: false, category: 'configuration', ambiguousWrite: false
        });
        expect(spy).not.toHaveBeenCalled();
    });

    it('does not follow redirects or guess an API path', async () => {
        const spy = vi.spyOn(axios, 'request').mockResolvedValue({ status: 302, data: {}, headers: { 'content-type': 'application/json' } });
        const out = await client.request('POST', '/pay', { ...cfg, base_url: 'https://provider.test/custom/path/' }, { body: {} });
        expect(spy.mock.calls[0][0]).toMatchObject({ url: 'https://provider.test/custom/path/pay', maxRedirects: 0 });
        expect(out).toMatchObject({ success: false, category: 'protocol', ambiguousWrite: true });
    });

    it.each([
        { status: 200, data: '<html>Login</html>', headers: { 'content-type': 'text/html' } },
        { status: 200, data: '<html>Login</html>' },
        { status: 200, data: null },
        { status: 200, data: true }
    ])('rejects HTML and malformed successful responses', async response => {
        vi.spyOn(axios, 'request').mockResolvedValue(response);
        expect(await client.request('POST', '/pay', cfg, { body: {} })).toMatchObject({ success: false,
            category: 'protocol', ambiguousWrite: true });
    });

    it.each(['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'EPROTO'])('holds ambiguous write outcome for transport %s', async code => {
        vi.spyOn(axios, 'request').mockRejectedValue({ code, message: 'token=session-secret&card=4242424242424242&cvc=123' });
        const write = await client.request('POST', '/pay', cfg, { body: {} });
        const read = await client.request('GET', '/balance', cfg);
        expect(write).toMatchObject({ success: false, category: 'transport', ambiguousWrite: true });
        expect(read.ambiguousWrite).toBe(false);
        expect(JSON.stringify(write)).not.toMatch(/session-secret|4242424242424242|cvc=123/);
    });

    it.each([
        [401, 'invalid_api_key', 'authentication', false],
        [403, 'insufficient_scope', 'permission', false],
        [429, null, 'rate_limit', true],
        [409, 'idempotency_conflict', 'business', true],
        [503, null, 'http', true]
    ])('classifies HTTP %s without echoing errors', async (status, detail, category, ambiguousWrite) => {
        vi.spyOn(axios, 'request').mockResolvedValue({ status, data: { detail: detail || 'session-secret' } });
        const out = await client.request('POST', '/pay', cfg);
        expect(out).toMatchObject({ success: false, category, ambiguousWrite });
        expect(JSON.stringify(out)).not.toContain('session-secret');
    });

    it('does not echo validation input or arbitrary supplier details', async () => {
        const secrets = { token: 'session-secret', number: '4242424242424242', cvc: '123', api_key: 'gptk_private' };
        vi.spyOn(axios, 'request').mockResolvedValue({ status: 422,
            data: { detail: [{ loc: ['body', 'session'], msg: 'session-secret', input: secrets }], message: JSON.stringify(secrets) } });
        const out = await client.request('POST', '/pay', cfg);
        expect(out.error).toBe('供应商请求字段校验失败');
        expect(JSON.stringify(out)).not.toMatch(/session-secret|4242424242424242|gptk_private/);
    });

    it.each([{ ok: true }, { ok: false, order_id: 1 }, { status: 'success', order_id: 1 }])('requires explicit acceptance and an upstream reference', async data => {
        vi.spyOn(axios, 'request').mockResolvedValue({ status: 200, data });
        expect(await client.submitPay(cfg, pay)).toMatchObject({ success: false, ambiguousWrite: true });
    });

    it('never silently chooses Plus or submits without a stable key', async () => {
        const spy = vi.spyOn(axios, 'request');
        expect(await client.inspectPay(cfg, { sessionToken: 'session-secret' })).toMatchObject({ success: false, ambiguousWrite: false });
        expect(await client.submitPay(cfg, { ...pay, idempotencyKey: null })).toMatchObject({ success: false, ambiguousWrite: false });
        expect(spy).not.toHaveBeenCalled();
    });

    it('forbids ambiguous card source and non-public-IP proxies before submission', async () => {
        const spy = vi.spyOn(axios, 'request');
        expect(await client.submitPay(cfg, { ...pay, cardId: 1, cvc: '123' })).toMatchObject({ success: false });
        expect(await client.submitPay(cfg, { ...pay, proxy: 'http://proxy.example:80' })).toMatchObject({ success: false });
        expect(spy).not.toHaveBeenCalled();
    });

    it('reports read checks separately and never claims write permissions were verified', async () => {
        const spy = vi.spyOn(axios, 'request').mockImplementation(async ({ url }) => ({ status: url.endsWith('/balance') ? 403 : 200,
            data: url.endsWith('/balance') ? { detail: 'insufficient_scope' } : { gpt: [{ key: 'plus' }], credit: [] } }));
        const out = await client.testConnection(cfg);
        expect(out.success).toBe(false);
        expect(out.checks).toEqual(expect.arrayContaining([
            expect.objectContaining({ key: 'plans', state: 'passed' }),
            expect.objectContaining({ key: 'balance', state: 'failed' }),
            expect.objectContaining({ key: 'create', state: 'unverified' }),
            expect.objectContaining({ key: 'order', state: 'unverified' })
        ]));
        expect(spy.mock.calls.every(([request]) => request.method === 'GET')).toBe(true);
    });

    it('does not leak supplier response credentials through plans, balance, or status', async () => {
        const spy = vi.spyOn(axios, 'request')
            .mockResolvedValueOnce({ status: 200, data: { gpt: [{ key: 'plus', enabled: 1, plan_name: 'chatgptplusplan', name: 'session-secret' }], session: 'session-secret' } })
            .mockResolvedValueOnce({ status: 200, data: { credits: 10, api_key: 'gptk_private', session: 'session-secret' } })
            .mockResolvedValueOnce({ status: 200, data: { status: 'failed', charged: false, charge_id: 'session-secret', cvc: '123' } });
        const plans = await client.fetchPlans(cfg);
        const balance = await client.queryBalance(cfg);
        const order = await client.queryOrder(cfg, 1);
        expect(JSON.stringify({ plans, balance, order })).not.toMatch(/session-secret|gptk_private/);
        expect(order.outcome.state).toBe('hold');
        expect(spy).toHaveBeenCalledTimes(3);
    });

    it('supplements only the documented original order endpoint and preserves ambiguous errors', async () => {
        const spy = vi.spyOn(axios, 'request').mockResolvedValueOnce({ status: 200, data: { ok: true, order_id: 12, expires_in: 900 } })
            .mockRejectedValueOnce({ code: 'ECONNABORTED' });
        expect(await client.supplementCredentials(cfg, 12, { cvc: '123', session: { access_token: 'session-secret' } })).toMatchObject({ success: true });
        expect(spy.mock.calls[0][0]).toMatchObject({ method: 'POST', url: 'https://provider.test/api/v1/orders/12/credentials',
            data: { cvc: '123', ttl: 900, session: { access_token: 'session-secret' } } });
        expect(await client.supplementCredentials(cfg, 12, { cvc: '123' })).toMatchObject({ success: false, ambiguousWrite: true });
    });
    it('preserves long numeric order references exactly for recovery', async () => {
        const spy = vi.spyOn(axios, 'request').mockResolvedValue({ status: 200, data: { id: '12345678901234567890', status: 'pending' } });
        const result = await client.queryOrder(cfg, '12345678901234567890');
        expect(result.data.id).toBe('12345678901234567890');
        expect(spy.mock.calls[0][0].url).toBe('https://provider.test/api/v1/pay/orders/12345678901234567890');
    });
});
