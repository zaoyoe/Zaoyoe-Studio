'use strict';

const crypto = require('node:crypto');
const { createGptOutsourcingService } = require('../gpt-outsourcing-worker');
const domain = require('../gpt-outsourcing');
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const session = { access_token: 'private-session', user: { email: 'user@example.com' } };

// Everything below is an in-memory provider and resource ledger. No real HTTP,
// database, card reservation or payment is performed by these regression tests.
function harness({ initialAttempt, planType = 'plus', mapping, result, submit, maxPolls = 1 } = {}) {
    const state = { attempt: clone(initialAttempt) || { version: 0, jobKey: 'job-1' },
        cdk: 'reserved', card: 'available', settled: null, releases: 0, events: [] };
    const cfg = { enabled: true, base_url: 'https://provider.test/api/v1', api_key: 'private-api-key',
        country: 'US', currency: 'USD', plan_mapping: mapping || { [planType]: `provider-${planType}` } };
    const providerPlan = Object.values(cfg.plan_mapping)[0] || 'provider-plus';
    const plans = Object.entries(domain.OUTSOURCE_PLAN_NAMES).map(([key, name]) => ({
        key: `provider-${key}`, enabled: true, plan_name: name
    }));
    const store = {
        getGptApiAttempt: vi.fn(async () => clone(state.attempt)),
        getGptApiConfig: vi.fn(async () => clone(cfg)),
        getActiveProxy: vi.fn(async () => null),
        saveGptApiAttempt: vi.fn(async (jobKey, patch) => {
            state.attempt = { ...state.attempt, ...clone(patch), jobKey };
            state.events.push({ operation: 'persist', attempt: clone(state.attempt) });
            return clone(state.attempt);
        }),
        updateTaskLog: vi.fn(async () => {}),
        reserveGptApiCard: vi.fn(async jobKey => {
            state.card = 'reserved';
            state.attempt = { ...state.attempt, jobKey, cardAssetId: 7, cardLockOwner: `gptapi_${jobKey}`, cardLast4: '4242' };
            return { attempt: clone(state.attempt), card: { card_number: '4242424242424242',
                card_expiry: '12/30', card_cvc: '123', card_holder: 'Offline Test' } };
        }),
        finalizeGptApiAttempt: vi.fn(async (jobKey, { outcome, record, message, paymentState }) => {
            if (state.settled) return { applied: false, alreadySettled: true, assetsHeld: false, attempt: clone(state.attempt) };
            const held = outcome === 'hold';
            state.attempt = { ...state.attempt, ...clone(record), jobKey, recoveryRequired: held,
                paymentState, message };
            if (!held) {
                state.settled = outcome;
                state.attempt.state = 'finished';
                state.cdk = outcome === 'success' ? 'used' : 'unused';
                if (state.card === 'reserved') { state.card = 'available'; state.releases++; }
            }
            return { applied: true, assetsHeld: held, attempt: clone(state.attempt) };
        })
    };
    const orderData = { id: 101, status: 'success', plan: providerPlan, currency: 'USD',
        recharge_account: 'user@example.com', ...(result || {}) };
    const response = (data, source) => ({ success: true, data: domain.sanitizeOutsourceSnapshot(data),
        outcome: domain.classifyOutsourceResult(data, source) });
    const client = {
        fetchPlans: vi.fn(async () => ({ success: true, plans })),
        inspectPay: vi.fn(async () => ({ success: true, data: { ok: true, verified: true } })),
        submitPay: vi.fn(async (config, body) => {
            state.events.push({ operation: 'submit', body: clone(body) });
            return submit || { success: true, orderId: 101, taskId: 202, data: { ok: true, order_id: 101, task_id: 202 } };
        }),
        queryOrder: vi.fn(async () => response(orderData, 'order')),
        queryTask: vi.fn(async () => response({ id: 202, status: 'success', result: { ok: true } }, 'task')),
        supplementCredentials: vi.fn(async () => ({ success: true, data: { ok: true, order_id: 101 } }))
    };
    const callbacks = { onUpdate: vi.fn(), onLog: vi.fn(), onOutcome: vi.fn() };
    const service = createGptOutsourcingService({ store, client, ...callbacks, wait: vi.fn(async () => {}),
        now: () => 100000, maxPolls });
    return { state, cfg, store, client, service, callbacks, response, orderData,
        run: () => service.run({ task: { jobKey: 'job-1' }, token: 'private-session', session,
            cdk: { code: 'CDK-1' }, planType }) };
}

function recovering(h, patch = {}) {
    h.state.attempt = { version: 1, jobKey: 'job-1', attemptId: 'original-attempt', endpoint: h.cfg.base_url,
        apiKeyFingerprint: digest(h.cfg.api_key), accountFingerprint: domain.accountFingerprint('user@example.com'),
        planKey: 'provider-plus', country: 'US', currency: 'USD', orderId: 101, taskId: 202,
        state: 'unknown', dispatchStarted: true, recoveryRequired: true, cardAssetId: 7,
        idempotencyKey: 'original-idempotency', clientRef: 'original-ref', ...patch };
    h.state.card = 'reserved';
    return h;
}

describe('outbound GPT provider durable worker', () => {
    it('runs a fresh v0 task and persists the intent and exact card binding before dispatch', async () => {
        const h = harness();
        await h.run();
        const index = h.state.events.findIndex(event => event.operation === 'submit');
        const intent = h.state.events[index - 1].attempt;
        expect(intent).toMatchObject({ version: 1, state: 'submitting', dispatchStarted: true,
            cardAssetId: 7, endpoint: 'https://provider.test/api/v1', planKey: 'provider-plus' });
        expect(intent.requestFingerprint).toMatch(/^[a-f0-9]{64}$/);
        expect(intent.idempotencyKey).toBe(intent.clientRef);
        expect(h.state.events[index].body).toMatchObject({ idempotencyKey: intent.idempotencyKey,
            clientRef: intent.clientRef, newCard: { number: '4242424242424242', cvc: '123' } });
        expect(JSON.stringify(h.state.events.filter(event => event.operation === 'persist'))).not.toMatch(/private-session|private-api-key|4242424242424242|"cvc"/);
        expect(h.state).toMatchObject({ cdk: 'used', card: 'available', releases: 1 });
    });

    it.each(Object.keys(domain.OUTSOURCE_PLAN_NAMES))('uses explicit catalog proof for %s', async planType => {
        const h = harness({ planType });
        await h.run();
        expect(h.client.submitPay.mock.calls[0][1].planKey).toBe(`provider-${planType}`);
        expect(h.state.attempt.planName).toBe(domain.OUTSOURCE_PLAN_NAMES[planType]);
    });

    it.each(['go', 'pro_100', 'pro_200', 'pro_500', 'unknown'])('does not silently submit unmapped %s as Plus', async planType => {
        const h = harness({ planType, mapping: { plus: 'provider-plus' } });
        await h.run();
        expect(h.client.submitPay).not.toHaveBeenCalled();
        expect(h.store.reserveGptApiCard).not.toHaveBeenCalled();
        expect(h.state).toMatchObject({ cdk: 'unused', card: 'available' });
    });

    it('stops before card reservation when the provider product differs from the requested product', async () => {
        const h = harness();
        h.client.fetchPlans.mockResolvedValue({ success: true, plans: [{ key: 'provider-plus', enabled: true, plan_name: 'chatgptpro' }] });
        await h.run();
        expect(h.client.submitPay).not.toHaveBeenCalled();
        expect(h.store.reserveGptApiCard).not.toHaveBeenCalled();
    });

    it('keeps ambiguous submissions held across run and recheck without resending', async () => {
        const h = harness({ submit: { success: false, category: 'transport', errorCode: 'TRANSPORT_TIMEOUT', ambiguousWrite: true } });
        await h.run();
        expect(h.state).toMatchObject({ cdk: 'reserved', card: 'reserved', releases: 0 });
        expect(h.state.attempt).toMatchObject({ state: 'unknown', dispatchStarted: true, recoveryRequired: true });
        await h.run();
        await h.service.recheck('job-1');
        expect(h.client.submitPay).toHaveBeenCalledOnce();
        expect(h.store.reserveGptApiCard).toHaveBeenCalledOnce();
        expect(h.state.releases).toBe(0);
    });

    it('releases only an explicitly rejected pre-order request', async () => {
        const h = harness({ submit: { success: false, status: 400, errorCode: 'invalid_pan', ambiguousWrite: false } });
        await h.run();
        expect(h.state).toMatchObject({ cdk: 'unused', card: 'available', releases: 1 });
        expect(h.state.attempt).toMatchObject({ settlement: 'no_charge', lastErrorCode: 'invalid_pan' });
    });

    it.each(['unsuccessful', 'done', 'system_error', 'stalled', 'manual', 'failed', 'declined', 'cancelled'])
    ('holds non-success state %s without no-charge proof', async status => {
        const h = harness({ result: { status } });
        await h.run();
        expect(h.state).toMatchObject({ cdk: 'reserved', card: 'reserved', releases: 0 });
        expect(h.callbacks.onOutcome).not.toHaveBeenCalled();
    });

    it('releases a positively confirmed decline', async () => {
        const h = harness({ result: { status: 'declined', decline_code: 'insufficient_funds' } });
        await h.run();
        expect(h.state).toMatchObject({ cdk: 'unused', card: 'available', releases: 1 });
    });

    it('queries the order endpoint preferentially and never mixes task and order IDs', async () => {
        const h = harness();
        await h.run();
        expect(h.client.queryOrder).toHaveBeenCalledWith(expect.any(Object), 101);
        expect(h.client.queryTask).not.toHaveBeenCalled();
        const taskOnly = harness({ submit: { success: true, taskId: 202, data: { ok: true, task_id: 202 } } });
        await taskOnly.run();
        expect(taskOnly.client.queryTask).toHaveBeenCalledWith(expect.any(Object), 202);
        expect(taskOnly.client.queryOrder).not.toHaveBeenCalled();
        expect(taskOnly.state.cdk).toBe('used');
    });

    it.each([
        { plan: 'provider-pro_200' }, { currency: 'PHP' }, { recharge_account: 'other@example.com' },
        { id: 999 }, { plan: undefined }, { currency: undefined }, { recharge_account: undefined }
    ])('does not settle an order with mismatched or missing identity', async mismatch => {
        const h = harness({ result: mismatch });
        await h.run();
        expect(h.state).toMatchObject({ cdk: 'reserved', card: 'reserved', releases: 0 });
        expect(h.state.attempt.lastErrorCode).toBe('OUTSOURCE_ORDER_MISMATCH');
    });

    it('holds supplier-reused orders rather than applying unrelated successful evidence', async () => {
        const h = harness({ submit: { success: true, orderId: 101, taskId: 202, alreadySubmitted: true, data: { ok: true } } });
        await h.run();
        expect(h.state.attempt.existingOrderReused).toBe(true);
        expect(h.state).toMatchObject({ cdk: 'reserved', card: 'reserved', releases: 0 });
    });

    it('holds a dispatched card if durable resolution persistence fails', async () => {
        const h = harness();
        h.store.finalizeGptApiAttempt.mockRejectedValue(new Error('offline disk failure'));
        await expect(h.run()).rejects.toMatchObject({ code: 'OUTSOURCE_PERSISTENCE_UNAVAILABLE' });
        expect(h.state).toMatchObject({ cdk: 'reserved', card: 'reserved', releases: 0 });
    });

    it('does not dispatch if the intent transaction fails', async () => {
        const h = harness();
        const save = h.store.saveGptApiAttempt.getMockImplementation();
        h.store.saveGptApiAttempt.mockImplementation(async (jobKey, patch) => {
            if (patch.state === 'submitting') throw new Error('offline transaction failure');
            return save(jobKey, patch);
        });
        await h.run();
        expect(h.client.submitPay).not.toHaveBeenCalled();
        expect(h.state).toMatchObject({ cdk: 'unused', card: 'available' });
    });

    it('holds a persisted intent when later task-state persistence fails before HTTP dispatch', async () => {
        const h = harness();
        h.store.updateTaskLog.mockImplementation(async () => {
            if (h.state.attempt.dispatchStarted) throw new Error('offline task persistence failure');
        });
        await h.run();
        expect(h.client.submitPay).not.toHaveBeenCalled();
        expect(h.state).toMatchObject({ cdk: 'reserved', card: 'reserved', releases: 0 });
    });

    it('rechecks the original order read-only and settlement is idempotent', async () => {
        const h = recovering(harness());
        await h.service.recheck('job-1');
        await h.service.recheck('job-1');
        expect(h.client.submitPay).not.toHaveBeenCalled();
        expect(h.client.supplementCredentials).not.toHaveBeenCalled();
        expect(h.store.reserveGptApiCard).not.toHaveBeenCalled();
        expect(h.client.queryOrder).toHaveBeenCalledOnce();
        expect(h.store.finalizeGptApiAttempt).toHaveBeenCalledOnce();
        expect(h.callbacks.onOutcome).toHaveBeenCalledOnce();
        expect(h.state.releases).toBe(1);
    });

    it('cannot query a held order using a different provider key', async () => {
        const h = recovering(harness());
        h.cfg.api_key = 'rotated-api-key';
        await h.service.recheck('job-1');
        expect(h.client.queryOrder).not.toHaveBeenCalled();
        expect(h.client.submitPay).not.toHaveBeenCalled();
        expect(h.state).toMatchObject({ cdk: 'reserved', card: 'reserved' });
        expect(h.state.attempt.lastErrorCode).toBe('OUTSOURCE_CHANNEL_CHANGED');
    });

    it('supplements only a freshly verified requires_cvc original order', async () => {
        const h = recovering(harness({ result: { status: 'requires_cvc' } }));
        const result = await h.service.supplement('job-1', { cvc: '123', session });
        expect(result.accepted).toBe(true);
        expect(h.client.queryOrder).toHaveBeenCalledWith(expect.any(Object), 101);
        expect(h.client.supplementCredentials).toHaveBeenCalledWith(expect.any(Object), 101, { cvc: '123', session });
        expect(h.client.submitPay).not.toHaveBeenCalled();
        expect(h.state).toMatchObject({ cdk: 'reserved', card: 'reserved', releases: 0 });
    });

    it.each([
        ['missing email', { access_token: 'replacement-session' }],
        ['different email', { access_token: 'replacement-session', user: { email: 'other@example.com' } }]
    ])('rejects a %s Session when supplementing the original account', async (_label, replacementSession) => {
        const h = recovering(harness({ result: { status: 'requires_cvc' } }));
        await expect(h.service.supplement('job-1', { cvc: '123', session: replacementSession }))
            .rejects.toMatchObject({ code: 'OUTSOURCE_ACCOUNT_MISMATCH' });
        expect(h.client.supplementCredentials).not.toHaveBeenCalled();
        expect(h.state).toMatchObject({ cdk: 'reserved', card: 'reserved', releases: 0 });
    });

    it('learns an order id from a task response and validates the original order before settlement', async () => {
        const h = recovering(harness());
        h.state.attempt.orderId = null;
        h.client.queryTask.mockResolvedValue(h.response({
            task: { id: 202, order_id: 101, status: 'pending' }
        }, 'task'));

        await h.service.recheck('job-1');

        expect(h.client.queryTask).toHaveBeenCalledOnce();
        expect(h.client.queryOrder).toHaveBeenCalledWith(expect.any(Object), '101');
        expect(h.store.saveGptApiAttempt).toHaveBeenCalledWith('job-1', { orderId: '101' });
        expect(h.state).toMatchObject({ cdk: 'used', card: 'available', releases: 1 });
    });

    it.each(['pending', 'system_error', 'success', 'needs_cvc'])('does not supplement %s', async status => {
        const h = recovering(harness({ result: { status } }));
        await expect(h.service.supplement('job-1', { cvc: '123', session })).rejects.toMatchObject({ code: 'OUTSOURCE_CREDENTIALS_NOT_REQUIRED' });
        expect(h.client.supplementCredentials).not.toHaveBeenCalled();
        expect(h.client.submitPay).not.toHaveBeenCalled();
    });

    it('keeps assets held if credential supplementation times out', async () => {
        const h = recovering(harness({ result: { status: 'requires_cvc' } }));
        h.client.supplementCredentials.mockResolvedValue({ success: false, ambiguousWrite: true, errorCode: 'TRANSPORT_TIMEOUT' });
        const out = await h.service.supplement('job-1', { cvc: '123' });
        expect(out.accepted).toBe(false);
        expect(h.state).toMatchObject({ cdk: 'reserved', card: 'reserved', releases: 0 });
        expect(h.state.attempt.lastErrorCode).toBe('OUTSOURCE_CREDENTIALS_RESPONSE_UNKNOWN');
    });
});
