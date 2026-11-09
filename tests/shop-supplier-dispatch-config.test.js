'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    DEFAULT_THRESHOLD_CNY,
    POLICY_CONFIG_KEY,
    getSupplierDispatchPolicy,
    saveSupplierDispatchPolicy,
    shouldAutoDispatch,
    tryAutoDispatchSupplierOrder
} = require('../server/integrations/suppliers/auto-dispatch');
const { createSupplierCatalogHandler } = require('../server/api-handlers/admin/shop/supplier-catalog');

function createResponse() {
    return {
        statusCode: 200,
        headers: {},
        body: '',
        status(code) { this.statusCode = code; return this; },
        setHeader(name, value) { this.headers[name] = value; return this; },
        end(value = '') { this.body = String(value); return this; },
        json() { return this.body ? JSON.parse(this.body) : {}; }
    };
}

test('getSupplierDispatchPolicy returns default when no policy configured', async () => {
    const mockDb = {
        from(table) {
            assert.strictEqual(table, 'system_config');
            return {
                select() {
                    return {
                        eq() {
                            return {
                                maybeSingle: async () => ({ data: null, error: null })
                            };
                        }
                    };
                }
            };
        }
    };

    const policy = await getSupplierDispatchPolicy(mockDb);
    assert.strictEqual(policy.enabled, true);
    assert.strictEqual(policy.mode, 'threshold');
    assert.strictEqual(policy.thresholdCny, DEFAULT_THRESHOLD_CNY);
});

test('saveSupplierDispatchPolicy validates input and persists to system_config', async () => {
    let upsertPayload = null;
    const mockDb = {
        from(table) {
            assert.strictEqual(table, 'system_config');
            return {
                upsert(payload) {
                    upsertPayload = payload;
                    return Promise.resolve({ error: null });
                }
            };
        }
    };

    const saved = await saveSupplierDispatchPolicy(mockDb, {
        mode: 'threshold',
        thresholdCny: 25.50,
        enabled: true
    });

    assert.strictEqual(saved.mode, 'threshold');
    assert.strictEqual(saved.thresholdCny, 25.50);
    assert.strictEqual(upsertPayload.config_key, POLICY_CONFIG_KEY);
    assert.strictEqual(upsertPayload.config_value.thresholdCny, 25.50);

    // Rejects negative threshold
    await assert.rejects(
        () => saveSupplierDispatchPolicy(mockDb, { mode: 'threshold', thresholdCny: -5 }),
        /Invalid threshold amount/
    );
});

test('shouldAutoDispatch correctly partitions orders by threshold and mode', () => {
    const policy = { enabled: true, mode: 'threshold', thresholdCny: 10.00 };

    // Under or equal to threshold -> Link B (true)
    assert.strictEqual(shouldAutoDispatch(policy, 0.17), true, '小额 0.17 应走链路 B');
    assert.strictEqual(shouldAutoDispatch(policy, 9.99), true, '9.99 应走链路 B');
    assert.strictEqual(shouldAutoDispatch(policy, 10.00), true, '刚好 10.00 应走链路 B');

    // Over threshold -> Link A (false)
    assert.strictEqual(shouldAutoDispatch(policy, 10.01), false, '10.01 应走链路 A');
    assert.strictEqual(shouldAutoDispatch(policy, 158.00), false, '158 应走链路 A');

    // manual_all mode -> always Link A (false)
    assert.strictEqual(shouldAutoDispatch({ enabled: true, mode: 'manual_all', thresholdCny: 100 }, 0.17), false);

    // auto_all mode -> always Link B (true)
    assert.strictEqual(shouldAutoDispatch({ enabled: true, mode: 'auto_all', thresholdCny: 10 }, 500), true);

    // disabled policy -> false
    assert.strictEqual(shouldAutoDispatch({ enabled: false, mode: 'threshold', thresholdCny: 10 }, 1), false);
});

test('tryAutoDispatchSupplierOrder skips orders exceeding threshold and preserves Route A', async () => {
    let policyRead = false;
    const mockDb = {
        from(table) {
            if (table === 'system_config') {
                policyRead = true;
                return {
                    select: () => ({
                        eq: () => ({
                            maybeSingle: async () => ({
                                data: { config_value: { mode: 'threshold', thresholdCny: 10.00, enabled: true } },
                                error: null
                            })
                        })
                    })
                };
            }
            throw new Error(`Unexpected table ${table}`);
        }
    };

    const bigOrder = {
        id: '11111111-2222-4333-8444-555555555555',
        fulfillment_source: 'supplier_v2',
        payment_status: 'confirmed',
        fulfillment_status: 'pending',
        total_amount: 58.00
    };

    const result = await tryAutoDispatchSupplierOrder({ supabase: mockDb, order: bigOrder });
    assert.strictEqual(policyRead, true);
    assert.strictEqual(result.status, 'skipped');
    assert.strictEqual(result.reason, 'route_a_manual_review_required');
    assert.strictEqual(result.orderAmountCny, 58.00);
    assert.strictEqual(result.thresholdCny, 10.00);
});

test('supplier catalog API handles dispatch-config GET and POST', async () => {
    let storedConfig = { mode: 'threshold', thresholdCny: 15.00, enabled: true };
    const mockDb = {
        from(table) {
            if (table === 'system_config') {
                return {
                    select: () => ({
                        eq: () => ({
                            maybeSingle: async () => ({
                                data: { config_value: storedConfig },
                                error: null
                            })
                        })
                    }),
                    upsert: (payload) => {
                        storedConfig = payload.config_value;
                        return Promise.resolve({ error: null });
                    }
                };
            }
            throw new Error(`Unexpected table ${table}`);
        }
    };

    let auditLogged = false;
    const dependencies = {
        requireAdmin: async () => ({ supabase: mockDb, user: { id: 'admin-1' } }),
        parseJsonBody: async (req) => req.body || {},
        sendJson: (res, status, payload) => res.status(status).setHeader('Content-Type', 'application/json').end(JSON.stringify(payload)),
        writeAdminAuditLog: async () => { auditLogged = true; }
    };

    const handler = createSupplierCatalogHandler(dependencies);

    // 1. GET dispatch-config
    const getReq = { method: 'GET', url: '/api/admin/shop/supplier-catalog?action=dispatch-config' };
    const getRes = createResponse();
    await handler(getReq, getRes);
    assert.strictEqual(getRes.statusCode, 200);
    const getPayload = getRes.json();
    assert.strictEqual(getPayload.success, true);
    assert.strictEqual(getPayload.policy.thresholdCny, 15.00);

    // 2. POST dispatch-config
    const postReq = {
        method: 'POST',
        url: '/api/admin/shop/supplier-catalog',
        body: {
            action: 'dispatch-config',
            mode: 'threshold',
            thresholdCny: 30.00,
            enabled: true
        }
    };
    const postRes = createResponse();
    await handler(postReq, postRes);
    assert.strictEqual(postRes.statusCode, 200);
    const postPayload = postRes.json();
    assert.strictEqual(postPayload.success, true);
    assert.strictEqual(postPayload.policy.thresholdCny, 30.00);
    assert.strictEqual(auditLogged, true);
});
