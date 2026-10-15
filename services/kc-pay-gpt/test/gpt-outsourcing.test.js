'use strict';
const domain = require('../gpt-outsourcing');

describe('GPT outsourcing strict catalog', () => {
    const cfg = { base_url: 'https://provider.test/api/v1/', api_key: 'private-key',
        plan_mapping: { plus: 'provider-plus' }, country: 'US', currency: 'USD' };
    const plans = [{ key: 'provider-plus', enabled: 1, plan_name: 'chatgptplusplan' }];

    it('requires an explicitly configured HTTPS API path', () => {
        expect(domain.validateOutsourceConfig(cfg)).toMatchObject({ base_url: 'https://provider.test/api/v1' });
        expect(() => domain.validateOutsourceConfig({ ...cfg, base_url: 'https://provider.test' })).toThrow();
        expect(() => domain.validateOutsourceConfig({ ...cfg, base_url: 'https://secret:password@provider.test/api/v1' })).toThrow();
        expect(() => domain.validateOutsourceConfig({ ...cfg, api_key: 'value\nheader' })).toThrow();
    });
    it('accepts a canonical mapping only when the enabled catalog proves the official product', () => {
        expect(domain.resolveOutsourcePlan('plus', plans, cfg.plan_mapping)).toMatchObject({
            localPlan: 'plus', planKey: 'provider-plus', planName: 'chatgptplusplan'
        });
    });
    it.each(['go', 'pro_100', 'pro_200', 'pro_500'])('does not turn an unmapped %s into Plus', plan => {
        expect(() => domain.resolveOutsourcePlan(plan, plans, cfg.plan_mapping)).toThrow(/未设置/);
    });
    it.each([{}, { enabled: 0 }, { enabled: false }, { enabled: 'false' }, { enabled: 1, plan_name: 'ChatGPT Plus' },
        { enabled: 1, plan_name: 'chatgptpro' }])('rejects disabled, missing or mismatched evidence', changes => {
        expect(() => domain.resolveOutsourcePlan('plus', [{ key: 'provider-plus', ...changes }], cfg.plan_mapping)).toThrow();
    });
    it('rejects duplicate upstream keys instead of choosing the first price match', () => {
        expect(() => domain.resolveOutsourcePlan('plus', [...plans, ...plans], cfg.plan_mapping)).toThrow();
        expect(() => domain.resolveOutsourcePlan('pro_100', [{ key: 'pro', enabled: 1, price: 100 }], { pro_100: 'pro' })).toThrow();
    });
    it('uses the same canonical legacy Pro definitions as formal recharge', () => {
        expect(domain.canonicalizeOutsourcePlan('pro_5x')).toBe('pro_100');
        expect(domain.canonicalizeOutsourcePlan('pro20x')).toBe('pro_200');
        expect(() => domain.canonicalizeOutsourcePlan('pro')).toThrow();
        expect(() => domain.resolveOutsourcePlan('pro_20x', [{ key: 'pro20', enabled: true, plan_name: 'chatgptpro' }], { pro_200: 'pro20' })).not.toThrow();
    });
    it('rejects conflicting alias mappings and mismatched region pairs', () => {
        expect(() => domain.validateOutsourceConfig({ ...cfg, plan_mapping: { pro_5x: 'old', pro_100: 'new' } })).toThrow();
        expect(() => domain.validateOutsourceConfig({ ...cfg, country: 'US', currency: 'PHP' })).toThrow();
    });
    it('treats blank UI mapping fields as unsupported plans', () => {
        expect(domain.normalizePlanMapping({ plus: 'provider-plus', go: '', pro_100: '  ', pro_200: null })).toEqual({ plus: 'provider-plus' });
        expect(() => domain.resolveOutsourcePlan('go', plans, { plus: 'provider-plus', go: '' })).toThrow(/未设置/);
    });
});

describe('GPT outsourcing outcome and asset decisions', () => {
    const classify = domain.classifyOutsourceResult;
    it('trusts only an exact successful order state', () => {
        expect(classify({ status: 'success' }, 'order')).toMatchObject({ state: 'success', terminal: true, releaseAssets: false });
        for (const status of ['unsuccessful', 'success_pending', 'completed', 'paid', 'done']) {
            expect(classify({ status }, 'order')).toMatchObject({ state: 'hold', releaseAssets: false });
        }
        expect(classify({ status: 'failed', result: { status: 'success', ok: true } }, 'order').state).toBe('hold');
    });
    it('requires both task business success and a true payment result', () => {
        expect(classify({ status: 'success', result: { ok: true } }, 'task').state).toBe('success');
        for (const data of [{ status: 'success', result: { ok: false } }, { status: 'success' },
            { status: 'done', result: { status: 'success', ok: true } }, { queue_status: 'done' }]) {
            expect(classify(data, 'task')).toMatchObject({ state: 'hold', releaseAssets: false });
        }
    });
    it('holds contradictory success and preserves lossless numeric identifiers', () => {
        expect(classify({ order: { id: '12345678901234567890', status: 'success' }, ok: false }, 'order').state).toBe('hold');
        expect(classify({ status: 'success', result: { ok: false } }, 'order').state).toBe('hold');
        expect(classify({ status: 'success', result: { ok: true, status: 'success', no_charge: true } }, 'task').state).toBe('hold');
        expect(domain.sanitizeOutsourceSnapshot({ order_id: '12345678901234567890' }).order_id).toBe('12345678901234567890');
    });
    it('passes hashed account and product identity without exposing the account', () => {
        const data = { id: 1, status: 'success', plan: 'provider-plus', currency: 'USD', recharge_account: ' User@Example.COM ' };
        const out = classify(data, 'order');
        expect(out).toMatchObject({ source: 'order', accountFingerprint: domain.accountFingerprint('user@example.com'), planKey: 'provider-plus', currency: 'USD' });
        expect(out.snapshot).toMatchObject({ account_fingerprint: out.accountFingerprint, plan: 'provider-plus', currency: 'USD' });
        expect(JSON.stringify(out)).not.toContain('Example');
    });
    it.each(['system_error', 'stalled', 'manual', 'unknown', 'manual_review'])('retains assets for uncertain %s', status => {
        expect(classify({ status, charged: false }, 'order')).toMatchObject({ state: 'hold', releaseAssets: false });
    });
    it.each(['failed', 'declined', 'cancelled'])('retains assets for %s without definitive no-charge evidence', status => {
        expect(classify({ status, settled_at: '2026-08-14 12:27:01' }, 'order')).toMatchObject({ state: 'hold', releaseAssets: false });
        expect(classify({ status, no_charge: true }, 'order')).toMatchObject({ state: 'confirmed_no_charge', releaseAssets: true });
    });
    it('retains assets if any charged evidence conflicts with a no-charge flag or decline', () => {
        for (const proof of [{ charge_id: 'ch_secret' }, { charged: true }, { payment_charged: true },
            { payment_state: 'captured' }, { settlement: { status: 'paid' } }]) {
            const response = { status: 'declined', no_charge: true, decline_code: 'insufficient_funds', ...proof };
            expect(classify(response, 'order')).toMatchObject({ state: 'hold', releaseAssets: false });
            expect(classify(domain.sanitizeOutsourceSnapshot(response), 'order').state).toBe('hold');
        }
        expect(classify({ status: 'failed', charged: false, result: { charge_id: 'ch_secret' } }, 'task').state).toBe('hold');
    });
    it('allows confirmed declines but never a freeform reason containing decline words', () => {
        expect(classify({ status: 'declined', decline_code: 'insufficient_funds' }, 'order').state).toBe('confirmed_no_charge');
        expect(classify({ status: 'declined', fail_reason: 'card declined' }, 'order').state).toBe('hold');
    });
    it.each(['requires_cvc', 'needs_cvc', 'requires_action'])('preserves %s as a held original order', status => {
        expect(classify({ status }, 'order')).toMatchObject({ state: 'requires_action', terminal: false, releaseAssets: false });
    });
    it('preserves safely allowlisted settlement proof across persisted snapshots', () => {
        const snapshot = domain.sanitizeOutsourceSnapshot({ status: 'failed', settlement: { status: 'no_charge', private: 'secret' } });
        expect(classify(snapshot, 'order').state).toBe('confirmed_no_charge');
    });
    it('requires the query source to be explicit and strips all freeform sensitive messages', () => {
        expect(() => classify({}, 'submit')).toThrow();
        const snapshot = domain.sanitizeOutsourceSnapshot({ id: 12, status: 'failed', error: 'token=secret', fail_reason: 'private',
            session: 'secret', card_number: '4242424242424242', cvc: '123', api_key: 'gptk_secret',
            result: { ok: false, decline_code: 'insufficient_funds', message: 'private', charge_id: 'ch_secret' } });
        expect(snapshot).toEqual({ id: 12, status: 'failed', result: { ok: false, decline_code: 'insufficient_funds', has_charge: true } });
        expect(JSON.stringify(snapshot)).not.toMatch(/secret|4242424242424242|private/);
    });
});

describe('GPT outsourcing protocol proxy rules', () => {
    it.each(['http://user:pass@8.8.8.8:80', 'https://8.8.8.8:443', 'socks5://1.1.1.1:1080'])('preserves explicit safe proxy %s', proxy => {
        expect(domain.normalizeOutsourceProxy(proxy)).toBe(proxy);
    });
    it.each(['http://localhost:80', 'http://127.0.0.1:80', 'http://10.0.0.1:80', 'http://proxy.test:80',
        'http://8.8.8.8', 'http://8.8.8.8:8080/path', 'http://8.8.8.8:8080?key=secret', 'ftp://8.8.8.8:21'])('rejects invalid proxy %s', proxy => {
        expect(() => domain.normalizeOutsourceProxy(proxy)).toThrow();
    });
    it('lets the provider choose its own route when no explicit proxy is supplied', () => {
        expect(domain.normalizeOutsourceProxy(null)).toBeNull();
    });
});
