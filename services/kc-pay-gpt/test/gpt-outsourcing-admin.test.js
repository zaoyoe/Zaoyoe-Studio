import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { createGptOutsourcingAdmin, publicOrder } = require('../gpt-outsourcing-admin');
const adminAuth = require('../admin-auth');
const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const config = { enabled: true, base_url: 'https://supplier.example/api', api_key: 'offline-provider-api-key',
    country: 'US', currency: 'USD', plan_mapping: { plus: 'plus-monthly' } };
const plan = { key: 'plus-monthly', plan_name: 'chatgptplusplan', enabled: true };
const protocolResult = () => ({ success: true, plans: [plan], gptPlans: [plan], creditPlans: [],
    balance: { credits: 10, balance_usd: 8 }, checks: [
        { key: 'plans', label: '套餐目录读取', state: 'passed' },
        { key: 'balance', label: '余额读取', state: 'passed' },
        { key: 'inspect', label: '凭证检查权限', state: 'unverified' },
        { key: 'create', label: '建单与付款权限', state: 'unverified' }
    ] });

function harness(overrides = {}) {
    const store = { getGptApiConfig: vi.fn(async () => ({ ...config, plan_mapping: { ...config.plan_mapping } })),
        saveGptApiConfig: vi.fn(async () => {}),
        listGptApiAttempts: vi.fn(async () => ({ orders: [], total: 0, limit: 10, offset: 0 })),
        ...overrides.store };
    const client = { maskApiKey: vi.fn(() => 'offl…key'), testConnection: vi.fn(async () => protocolResult()),
        inspectPay: vi.fn(async () => ({ success: true })), submitPay: vi.fn(),
        ...overrides.client };
    const service = { recheck: vi.fn(async () => ({ assetsHeld: true, attempt: { status: 'manual', recoveryRequired: true } })),
        supplement: vi.fn(async () => ({ accepted: true })), submit: vi.fn(), ...overrides.service };
    const log = vi.fn();
    const ensureStoreReady = vi.fn(async () => {});
    const handlers = createGptOutsourcingAdmin({ store, client, service, ensureStoreReady, log });
    async function invoke(name, req = {}) {
        const res = { statusCode: 200, value: null,
            status(code) { this.statusCode = code; return this; },
            json(value) { this.value = value; return this; } };
        await handlers[name]({ body: {}, query: {}, params: {}, ...req }, res);
        return res;
    }
    return { store, client, service, log, ensureStoreReady, handlers, invoke };
}

describe('GPT outsourcing admin configuration and protocol inspection', () => {
    it('returns a saved-key indicator and preview without returning the API key', async () => {
        const h = harness();
        const res = await h.invoke('getConfig');
        expect(res.value).toMatchObject({ success: true, config: { api_key_saved: true, api_key_preview: 'offl…key' } });
        expect(res.value.config).not.toHaveProperty('api_key');
        expect(JSON.stringify(res.value)).not.toContain(config.api_key);
        expect(h.client.testConnection).not.toHaveBeenCalled();
        expect(h.ensureStoreReady).toHaveBeenCalledOnce();
    });

    it('requires a new supplier key when changing the endpoint and never moves the saved key', async () => {
        const h = harness();
        const res = await h.invoke('saveConfig', { body: { ...config, base_url: 'https://other-supplier.example/api', api_key: '' } });
        expect(res.statusCode).toBe(400);
        expect(res.value.code).toBe('OUTSOURCE_NEW_ENDPOINT_KEY_REQUIRED');
        expect(h.store.saveGptApiConfig).not.toHaveBeenCalled();
        expect(h.client.testConnection).not.toHaveBeenCalled();
    });

    it('lets an old incomplete channel be disabled without inventing a supplier endpoint', async () => {
        const h = harness({ store: { getGptApiConfig: vi.fn(async () => ({ enabled: true, base_url: '', api_key: '',
            country: 'US', currency: 'USD', plan_mapping: {} })) } });
        const res = await h.invoke('saveConfig', { body: { enabled: false } });
        expect(res.value.success).toBe(true);
        expect(h.store.saveGptApiConfig).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, base_url: '', api_key: '' }));
        expect(h.client.testConnection).not.toHaveBeenCalled();
    });

    it('saves empty mappings as empty and marks them unready instead of guessing Plus', async () => {
        const h = harness();
        expect((await h.invoke('saveConfig', { body: { plan_mapping: { go: '', plus: '', pro_100: '', pro_200: '', pro_500: '' } } })).value.success).toBe(true);
        expect(h.store.saveGptApiConfig.mock.calls[0][0].plan_mapping).toEqual({});
        const res = await h.invoke('test', { body: { plan_mapping: {} } });
        expect(res.statusCode).toBe(400);
        expect(res.value.checks).toContainEqual(expect.objectContaining({ key: 'mapping', state: 'failed' }));
        expect(h.client.submitPay).not.toHaveBeenCalled();
    });

    it('preserves distinct passed, failed and unverified check states', async () => {
        const h = harness({ client: { testConnection: vi.fn(async () => ({ ...protocolResult(), success: false,
            checks: [ { key: 'plans', label: '套餐目录', state: 'passed' },
                { key: 'balance', label: '余额', state: 'failed', error: '余额接口未授权', code: 'insufficient_scope' },
                { key: 'create', label: '实际付款', state: 'unverified' } ] })) } });
        const res = await h.invoke('test');
        expect(res.statusCode).toBe(400);
        expect(res.value.checks).toEqual(expect.arrayContaining([
            expect.objectContaining({ key: 'plans', state: 'passed' }),
            expect.objectContaining({ key: 'balance', state: 'failed', error: '余额接口未授权', code: 'insufficient_scope' }),
            expect.objectContaining({ key: 'create', state: 'unverified' })
        ]));
        expect(h.client.inspectPay).not.toHaveBeenCalled();
        expect(h.client.submitPay).not.toHaveBeenCalled();
    });

    it('inspects an optional Session without building an order or claiming official login verification', async () => {
        const h = harness();
        const session = { accessToken: 'offline-session-for-inspection' };
        const res = await h.invoke('test', { body: { session } });
        expect(h.client.inspectPay).toHaveBeenCalledWith(expect.objectContaining({ api_key: config.api_key }), { planKey: 'plus-monthly', session });
        expect(res.value.checks).toContainEqual(expect.objectContaining({ key: 'inspect', state: 'passed' }));
        expect(res.value.checks).toContainEqual(expect.objectContaining({ key: 'official_login', state: 'unverified' }));
        expect(res.value.checks).toContainEqual(expect.objectContaining({ key: 'create', state: 'unverified' }));
        expect(JSON.stringify(res.value)).not.toContain(session.accessToken);
        expect(h.client.submitPay).not.toHaveBeenCalled();
        expect(h.service.submit).not.toHaveBeenCalled();
        expect(h.store.saveGptApiConfig).not.toHaveBeenCalled();
    });

    it('does not contact the supplier when status is requested for a disabled channel', async () => {
        const h = harness({ store: { getGptApiConfig: vi.fn(async () => ({ ...config, enabled: false })) } });
        const res = await h.invoke('status');
        expect(res.value).toMatchObject({ success: true, enabled: false, balance: null });
        expect(h.client.testConnection).not.toHaveBeenCalled();
    });

    it('queries only read-only supplier data when an enabled channel status is explicitly requested', async () => {
        const h = harness();
        const res = await h.invoke('status');
        expect(h.client.testConnection).toHaveBeenCalledOnce();
        expect(res.value).toMatchObject({ enabled: true, balance: { credits: 10 }, gpt_plans: [plan], credit_plans: [] });
        expect(h.client.inspectPay).not.toHaveBeenCalled();
        expect(h.client.submitPay).not.toHaveBeenCalled();
    });
});

describe('GPT outsourcing original-order operations and response privacy', () => {
    it('lists local orders with pagination and omits stored credentials, raw upstream payload and card secrets', async () => {
        const secretRow = { job_key: 'original-job', status: 'manual', cdk_code: 'KC-OFFLINE-SECRET',
            session_payload: 'offline-private-session', message: '待核查', card_number: '4242424242424242', cvc: '901',
            api_key: 'stored-provider-secret', gpt_api_raw: JSON.stringify({ raw: 'sensitive-upstream-body',
                attempt: { state: 'polling', planType: 'plus', planKey: 'plus-monthly', orderId: 42, taskId: 43,
                    cardLast4: '4242', cvc: '901', session: 'private-session-inside-attempt', apiKey: 'private-key-inside-attempt' } }) };
        const h = harness({ store: { listGptApiAttempts: vi.fn(async () => ({ orders: [secretRow], total: 21, limit: 5, offset: 10 })) } });
        const res = await h.invoke('orders', { query: { limit: '5', offset: '10', status: 'manual' } });
        expect(h.store.listGptApiAttempts).toHaveBeenCalledWith({ limit: '5', offset: '10', status: 'manual' });
        expect(res.value).toMatchObject({ success: true, total: 21, limit: 5, offset: 10,
            orders: [{ job_key: 'original-job', order_id: 42, task_id: 43, card_last4: '4242' }] });
        const output = JSON.stringify(res.value);
        for (const secret of ['KC-OFFLINE-SECRET', 'offline-private-session', '4242424242424242', '901',
            'stored-provider-secret', 'sensitive-upstream-body', 'private-session-inside-attempt', 'private-key-inside-attempt']) {
            expect(output).not.toContain(secret);
        }
        expect(h.client.testConnection).not.toHaveBeenCalled();
        expect(h.service.recheck).not.toHaveBeenCalled();
        expect(h.service.submit).not.toHaveBeenCalled();
    });

    it('provides action eligibility without reopening a settled payment', () => {
        const awaiting = publicOrder({ job_key: 'waiting-job', status: 'manual', gpt_api_raw: { attempt: {
            state: 'awaiting_credentials', upstreamStatus: 'requires_cvc', orderId: 42,
            endpoint: config.base_url, apiKeyFingerprint: 'f'.repeat(64), existingOrderReused: false } } });
        expect(awaiting).toMatchObject({ can_recheck: true, can_supplement_credentials: true });
        const settled = publicOrder({ job_key: 'finished-job', status: 'success', gpt_api_raw: { attempt: {
            state: 'finished', settlement: 'success', orderId: 42 } } });
        expect(settled).toMatchObject({ can_recheck: false, can_supplement_credentials: false, order_id: 42 });
    });

    it('fails closed on malformed historical fields and only returns normalized timestamps', () => {
        const poisoned = {
            job_key: '<img src=x onerror=alert(1)>', status: 'unexpected-private-status',
            updated_at: 'api_key=offline-secret', gpt_api_order_id: 'not-an-order-id',
            gpt_api_raw: { attempt: {
                state: 'private-session-payload', settlement: 'charged-but-unrecognized',
                upstreamStatus: 'session_expired_with_token', orderId: '000', taskId: 'offline-session',
                planType: 'unsupported', planKey: 'unsafe key', country: 'XX', currency: 'SECRET',
                createdAt: 'cvc=901', lastCheckedAt: { private: 'session-secret' },
                cardLast4: '424242', recoveryRequired: 'yes', endpoint: config.base_url,
                apiKeyFingerprint: 'f'.repeat(64), existingOrderReused: false
            } }
        };
        const sanitized = publicOrder(poisoned);
        expect(sanitized).toMatchObject({ job_key: null, status: 'manual', phase: 'legacy_unknown',
            order_id: null, task_id: null, plan_type: null, provider_plan_key: null,
            country: null, currency: null, card_last4: null, recovery_required: false,
            created_at: null, updated_at: null, last_checked_at: null,
            can_recheck: true, can_supplement_credentials: false });
        const output = JSON.stringify(sanitized);
        for (const secret of ['<img', 'offline-secret', 'offline-session', 'session-secret', 'cvc=901']) {
            expect(output).not.toContain(secret);
        }

        const normalized = publicOrder({ job_key: '1700000000000-abc123xy', created_at: '2026-10-14 12:30:45',
            updated_at: new Date('2026-10-14T04:30:46.000Z'), gpt_api_raw: { attempt: {
                lastCheckedAt: '2026-10-14T12:30:47+08:00'
            } } });
        expect(normalized).toMatchObject({ job_key: '1700000000000-abc123xy',
            created_at: '2026-10-14T12:30:45.000Z', updated_at: '2026-10-14T04:30:46.000Z',
            last_checked_at: '2026-10-14T04:30:47.000Z' });
        expect(publicOrder(null).job_key).toBeNull();
    });

    it('rechecks only the named original job and never creates another recharge order', async () => {
        const h = harness();
        const res = await h.invoke('recheck', { params: { jobKey: 'original-job' }, body: { order_id: 'forged-order' } });
        expect(h.service.recheck).toHaveBeenCalledExactlyOnceWith('original-job');
        expect(res.value).toMatchObject({ success: true, recovery_required: true });
        expect(h.service.submit).not.toHaveBeenCalled();
        expect(h.client.submitPay).not.toHaveBeenCalled();
    });

    it('supplements only the named original job and does not reflect CVC or Session', async () => {
        const h = harness();
        const body = { cvc: '902', session: { accessToken: 'offline-supplement-session' } };
        const res = await h.invoke('credentials', { params: { jobKey: 'original-job' }, body });
        expect(h.service.supplement).toHaveBeenCalledExactlyOnceWith('original-job', body);
        expect(res.value.success).toBe(true);
        expect(JSON.stringify(res.value)).not.toContain(body.cvc);
        expect(JSON.stringify(res.value)).not.toContain(body.session.accessToken);
        expect(h.service.submit).not.toHaveBeenCalled();
        expect(h.client.submitPay).not.toHaveBeenCalled();
    });

    it('keeps an uncertain supplement in a conflict response instead of reporting it accepted', async () => {
        const h = harness({ service: { supplement: vi.fn(async () => ({ accepted: false })) } });
        const res = await h.invoke('credentials', { params: { jobKey: 'original-job' }, body: { cvc: '903' } });
        expect(res.statusCode).toBe(409);
        expect(res.value.success).toBe(false);
        expect(res.value.message).toContain('已保留原订单和资产');
    });

    it.each(['OUTSOURCE_INVALID_INPUT', 'GPT_OUTSOURCE_CREDENTIALS_UNAVAILABLE', 'UNEXPECTED_OFFLINE_FAILURE'])
        ('does not reflect secrets from a %s exception', async code => {
            const error = Object.assign(new Error('accessToken=offline-token-private api_key=offline-api-key-private cvc=987'), { code });
            const h = harness({ service: { recheck: vi.fn(async () => { throw error; }) } });
            const res = await h.invoke('recheck', { params: { jobKey: 'original-job' } });
            expect(res.value.success).toBe(false);
            const output = JSON.stringify({ value: res.value, logs: h.log.mock.calls });
            for (const secret of ['offline-token-private', 'offline-api-key-private', '987']) expect(output).not.toContain(secret);
        });
});

describe('GPT outsourcing server route contract', () => {
    it('mounts every handler behind normal administrator authentication and preserves existing wrappers', () => {
        const routes = new Map();
        const outsourceAdmin = Object.fromEntries(['getConfig', 'saveConfig', 'test', 'status', 'orders', 'recheck', 'credentials']
            .map(name => [name, vi.fn()]));
        const requireSecondaryAuth = vi.fn();
        const context = { app: { get: (path, ...handlers) => routes.set(`GET ${path}`, handlers),
            post: (path, ...handlers) => routes.set(`POST ${path}`, handlers) },
            createGptOutsourcingAdmin: () => outsourceAdmin, store: {}, gptApi: {}, gptOutsourcing: {},
            ensureStoreReady: vi.fn(), logTask: vi.fn(), requireSecondaryAuth };
        const start = server.indexOf('const outsourceAdmin = createGptOutsourcingAdmin(');
        const end = server.indexOf("app.post('/api/admin/config'", start);
        expect(start).toBeGreaterThan(server.indexOf("app.use('/api/admin', authenticateAdmin)"));
        vm.runInNewContext(server.slice(start, end), context);
        expect(routes.get('GET /api/admin/gpt-api')).toEqual([outsourceAdmin.getConfig]);
        expect(routes.get('POST /api/admin/gpt-api')).toEqual([outsourceAdmin.saveConfig]);
        expect(routes.get('POST /api/admin/gpt-api/test')).toEqual([outsourceAdmin.test]);
        expect(routes.get('GET /api/admin/gpt-api/status')).toEqual([outsourceAdmin.status]);
        expect(routes.get('GET /api/admin/gpt-api/orders')).toEqual([outsourceAdmin.orders]);
        expect(routes.get('POST /api/admin/gpt-api/orders/:jobKey/recheck')).toEqual([requireSecondaryAuth, outsourceAdmin.recheck]);
        expect(routes.get('POST /api/admin/gpt-api/orders/:jobKey/credentials')).toEqual([requireSecondaryAuth, outsourceAdmin.credentials]);
    });

    it('keeps the existing secondary-auth compatibility wrapper as a pass-through', async () => {
        const store = { getConfig: vi.fn() };
        const ready = vi.fn();
        const next = vi.fn();
        const req = {};
        await adminAuth.createRequireSecondaryAuth(store, ready)(req, {}, next);
        expect(next).toHaveBeenCalledOnce();
        expect(req.secondaryAuth).toEqual({ bypassed: true });
        expect(store.getConfig).not.toHaveBeenCalled();
        expect(ready).not.toHaveBeenCalled();
    });
});
