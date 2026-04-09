const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const adminLib = require('../api/_lib/admin');

function createMockResponse() {
    const state = {
        statusCode: 200,
        body: ''
    };

    return {
        status(code) {
            state.statusCode = code;
            return this;
        },
        setHeader() {
            return this;
        },
        end(payload = '') {
            state.body = String(payload || '');
            return this;
        },
        json() {
            return state.body ? JSON.parse(state.body) : {};
        },
        get statusCode() {
            return state.statusCode;
        }
    };
}

async function withAdminHandler(handlerRelativePath, callback) {
    const handlerPath = path.resolve(__dirname, handlerRelativePath);
    const originalLoad = Module._load;
    const state = {
        requireAdminCalls: []
    };

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin' || request === '../../../api/_lib/admin') {
            return {
                async requireAdmin(req, options = {}) {
                    state.requireAdminCalls.push({ req, options });
                    const error = new Error('permission probe');
                    error.statusCode = 418;
                    throw error;
                },
                async parseJsonBody(req) {
                    return req.body || {};
                },
                normalizeAdminSite: adminLib.normalizeAdminSite,
                requireWritableAdminSite: adminLib.requireWritableAdminSite,
                sendJson(res, status, payload) {
                    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
                },
                async writeAdminAuditLog() {},
                getSupabaseAdmin() {
                    return {};
                }
            };
        }

        return originalLoad.call(this, request, parent, isMain);
    };

    let handler;
    try {
        handler = require(handlerPath);
    } finally {
        Module._load = originalLoad;
    }

    try {
        return await callback({ handler, state });
    } finally {
        delete require.cache[handlerPath];
    }
}

test('shop mutate handler requires shop.manage permission', async () => {
    await withAdminHandler('../server/api-handlers/admin/shop/mutate.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'POST', body: { action: 'noop' }, headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'shop.manage' });
    });
});

test('shop inventory handler requires shop.manage permission', async () => {
    await withAdminHandler('../server/api-handlers/admin/shop/inventory.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'shop.manage' });
    });
});

test('shop inventory detail handler requires shop.manage permission', async () => {
    await withAdminHandler('../server/api-handlers/admin/shop/inventory-detail.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'shop.manage' });
    });
});

test('shop products handler requires shop.manage permission', async () => {
    await withAdminHandler('../server/api-handlers/admin/shop/products.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'shop.manage' });
    });
});

test('shop categories handler requires shop.manage permission', async () => {
    await withAdminHandler('../server/api-handlers/admin/shop/categories.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'shop.manage' });
    });
});

test('discounts mutate handler requires discounts.manage permission', async () => {
    await withAdminHandler('../server/api-handlers/admin/discounts/mutate.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'POST', body: { action: 'create', site: 'cn' }, headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'discounts.manage' });
    });
});

test('discounts list handler requires discounts.manage permission', async () => {
    await withAdminHandler('../server/api-handlers/admin/discounts/list.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'discounts.manage' });
    });
});

test('discounts assets handler requires discounts.manage permission', async () => {
    await withAdminHandler('../server/api-handlers/admin/discounts/assets.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'POST', body: { action: 'assign', site: 'cn', discount_id: 'discount_1' }, headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'discounts.manage' });
    });
});

test('marketing assets center requires analytics.view permission for reads', async () => {
    await withAdminHandler('../server/api-handlers/admin/marketing/assets-center.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'analytics.view' });
    });
});

test('marketing assets center requires discounts.manage permission for workflow runs', async () => {
    await withAdminHandler('../server/api-handlers/admin/marketing/assets-center.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'POST', body: { action: 'run_workflow', workflow_key: 'discount_lifecycle_sync', site: 'cn' }, headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'discounts.manage' });
    });
});

test('homepage config handler requires homepage.manage permission', async () => {
    await withAdminHandler('../server/api-handlers/admin/homepage/config.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'homepage.manage' });
    });
});

test('points catalog handler requires points.manage permission', async () => {
    await withAdminHandler('../server/api-handlers/admin/points/catalog.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'points.manage' });
    });
});

test('points batches handler requires points.manage permission', async () => {
    await withAdminHandler('../server/api-handlers/admin/points/batches.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'points.manage' });
    });
});

test('points lookup handler requires points.manage permission', async () => {
    await withAdminHandler('../server/api-handlers/admin/points/lookup.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'points.manage' });
    });
});

test('points packages handler allows either points.manage or settings.manage', async () => {
    await withAdminHandler('../server/api-handlers/admin/points/packages.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, {
            anyOf: ['points.manage', 'settings.manage']
        });
    });
});

test('points manage handler requires points.manage permission', async () => {
    await withAdminHandler('../server/api-handlers/admin/points/manage.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'POST', body: { action: 'generate_codes', site: 'cn' }, headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'points.manage' });
    });
});

test('prompts manage handler allows prompts.manage or content.moderate for reads', async () => {
    await withAdminHandler('../server/api-handlers/admin/prompts/manage.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, {
            anyOf: ['prompts.manage', 'content.moderate']
        });
    });
});

test('prompts manage handler requires prompts.manage permission for writes', async () => {
    await withAdminHandler('../server/api-handlers/admin/prompts/manage.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'POST', body: { action: 'create' }, headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'prompts.manage' });
    });
});

test('comments list handler requires content.moderate permission', async () => {
    await withAdminHandler('../server/api-handlers/admin/comments/list.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'content.moderate' });
    });
});

test('comments blocks handler requires users.manage permission', async () => {
    await withAdminHandler('../server/api-handlers/admin/comments/blocks.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', url: '/api/admin/comments/blocks?userId=user_1', headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'users.manage' });
    });
});

test('comments summary handler requires content.moderate permission', async () => {
    await withAdminHandler('../server/api-handlers/admin/comments/summary.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'content.moderate' });
    });
});

test('comments moderate handler requires content.moderate permission', async () => {
    await withAdminHandler('../server/api-handlers/admin/comments/moderate.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'POST', body: {}, headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'content.moderate' });
    });
});

test('payments cleanup handler requires payments.manage permission', async () => {
    await withAdminHandler('../server/api-handlers/admin/payments/cleanup.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'POST', body: {}, headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'payments.manage' });
    });
});

test('shop refund handler requires shop.manage permission', async () => {
    await withAdminHandler('../server/api-handlers/admin/payments/shop-refund.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'POST', body: {}, headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'shop.manage' });
    });
});

test('tickets create handler requires tickets.manage permission', async () => {
    await withAdminHandler('../server/api-handlers/admin/tickets/create.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'POST', body: {}, headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'tickets.manage' });
    });
});

test('tickets list handler requires tickets.manage permission', async () => {
    await withAdminHandler('../server/api-handlers/admin/tickets/list.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'tickets.manage' });
    });
});

test('tickets metrics handler requires tickets.manage permission', async () => {
    await withAdminHandler('../server/api-handlers/admin/tickets/metrics.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'tickets.manage' });
    });
});

test('tickets history handler requires tickets.manage permission', async () => {
    await withAdminHandler('../server/api-handlers/admin/tickets/history.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', url: '/api/admin/tickets/history?ticketId=ticket-1', headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'tickets.manage' });
    });
});

test('tickets assign handler requires tickets.manage permission', async () => {
    await withAdminHandler('../server/api-handlers/admin/tickets/assign.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'POST', body: { ticketIds: ['ticket-1'], operation: 'assign_self' }, headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'tickets.manage' });
    });
});

test('tickets batch process handler requires tickets.manage permission', async () => {
    await withAdminHandler('../server/api-handlers/admin/tickets/batch-process.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'POST', body: { ticketIds: ['ticket-1'], newStatus: 'RESOLVED' }, headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'tickets.manage' });
    });
});

test('tickets summary actions handler requires tickets.manage permission', async () => {
    await withAdminHandler('../server/api-handlers/admin/tickets/summary-actions.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'POST', body: { jobId: 'job-1', action: 'request_retry' }, headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'tickets.manage' });
    });
});

test('tickets summary history handler requires tickets.manage permission', async () => {
    await withAdminHandler('../server/api-handlers/admin/tickets/summary-history.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', url: '/api/admin?route=tickets/summary-history&jobId=job-1', headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'tickets.manage' });
    });
});

test('settings gemini-key handler requires settings.manage permission', async () => {
    await withAdminHandler('../server/api-handlers/admin/settings/gemini-key.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'settings.manage' });
    });
});

test('settings codex-config handler requires settings.manage permission', async () => {
    await withAdminHandler('../server/api-handlers/admin/settings/codex-config.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'settings.manage' });
    });
});

test('ops alerts settings handler requires ops_alerts.manage permission', async () => {
    await withAdminHandler('../server/api-handlers/admin/settings/ops-alerts.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'ops_alerts.manage' });
    });
});

test('admin gemini proxy allows either prompts.manage or content.moderate', async () => {
    await withAdminHandler('../server/api-handlers/admin/gemini.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, {
            anyOf: ['prompts.manage', 'content.moderate']
        });
    });
});

test('admin codex proxy allows either prompts.manage or content.moderate', async () => {
    await withAdminHandler('../server/api-handlers/admin/codex.js', async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', headers: {} }, res);

        assert.equal(res.statusCode, 418);
        assert.deepEqual(state.requireAdminCalls[0]?.options, {
            anyOf: ['prompts.manage', 'content.moderate']
        });
    });
});
