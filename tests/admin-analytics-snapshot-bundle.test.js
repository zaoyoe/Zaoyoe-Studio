const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

function createMockResponse() {
    const state = {
        statusCode: 200,
        headers: {},
        body: ''
    };

    return {
        status(code) {
            state.statusCode = Number(code) || 200;
            return this;
        },
        setHeader(name, value) {
            state.headers[String(name).toLowerCase()] = value;
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

async function withHandler(options = {}, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/analytics/snapshot-bundle.js');
    const originalLoad = Module._load;
    const state = {
        childCalls: []
    };

    function buildMockChild(route, payload = {}) {
        return async (req, res) => {
            state.childCalls.push({
                route,
                url: req.url,
                adminRoute: req.adminRoute,
                adminSite: req.adminSite
            });

            const resolvedPayload = typeof payload === 'function'
                ? payload(req)
                : payload;
            const statusCode = Number(resolvedPayload?.statusCode) || 200;
            const body = resolvedPayload?.body && typeof resolvedPayload.body === 'object'
                ? resolvedPayload.body
                : {
                    success: true,
                    route
                };

            res.status(statusCode).setHeader('Content-Type', 'application/json; charset=utf-8').end(JSON.stringify(body));
        };
    }

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                normalizeAdminSite(value, config = {}) {
                    const normalized = String(value || '').trim().toLowerCase();
                    if (['cn', 'intl', 'all'].includes(normalized)) {
                        return normalized;
                    }
                    return String(config?.defaultValue || '').trim().toLowerCase() || '';
                },
                sendJson(res, status, payload) {
                    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
                }
            };
        }

        if (request === '../payments/summary') {
            return buildMockChild('payments/summary', options.payments || {});
        }

        if (request === '../tickets/metrics') {
            return buildMockChild('tickets/metrics', options.tickets || {});
        }

        if (request === '../comments/summary') {
            return buildMockChild('comments/summary', options.comments || {});
        }

        if (request === '../settings/verify-monitor') {
            return buildMockChild('settings/verify-monitor', options.verifyMonitor || {});
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

test('analytics snapshot bundle aggregates admin sub-handlers and forwards range context', async () => {
    await withHandler({
        payments: {
            body: {
                success: true,
                overview: { paid_orders: 12 }
            }
        },
        tickets: {
            body: {
                success: true,
                overview: { backlog: { total_pending: 3 } }
            }
        },
        comments: {
            body: {
                success: true,
                summary: { totalCount: 18 }
            }
        },
        verifyMonitor: {
            body: {
                success: true,
                summary: { total_task_count: 7 }
            }
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({
            method: 'GET',
            url: '/api/admin?route=analytics/snapshot-bundle&site=INTL&view=ops&days=30&taskPageSize=6&failurePageSize=4',
            headers: {}
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.site, 'intl');
        assert.equal(payload.partial_failure_count, 0);
        assert.equal(payload.payments.ok, true);
        assert.equal(payload.tickets.ok, true);
        assert.equal(payload.comments.ok, true);
        assert.equal(payload.verifyMonitor.ok, true);

        assert.equal(state.childCalls.length, 4);
        const paymentsCall = state.childCalls.find((entry) => entry.route === 'payments/summary');
        const ticketsCall = state.childCalls.find((entry) => entry.route === 'tickets/metrics');
        const commentsCall = state.childCalls.find((entry) => entry.route === 'comments/summary');
        const verifyCall = state.childCalls.find((entry) => entry.route === 'settings/verify-monitor');

        assert.ok(paymentsCall);
        assert.ok(ticketsCall);
        assert.ok(commentsCall);
        assert.ok(verifyCall);

        const paymentsUrl = new URL(paymentsCall.url, 'http://localhost');
        assert.equal(paymentsCall.adminRoute, 'payments/summary');
        assert.equal(paymentsCall.adminSite, 'intl');
        assert.equal(paymentsUrl.searchParams.get('route'), 'payments/summary');
        assert.equal(paymentsUrl.searchParams.get('site'), 'intl');
        assert.equal(paymentsUrl.searchParams.get('view'), 'ops');
        assert.equal(paymentsUrl.searchParams.get('days'), '30');

        const commentsUrl = new URL(commentsCall.url, 'http://localhost');
        assert.equal(commentsUrl.searchParams.get('route'), 'comments/summary');
        assert.equal(commentsUrl.searchParams.get('site'), 'intl');

        const ticketsUrl = new URL(ticketsCall.url, 'http://localhost');
        assert.equal(ticketsUrl.searchParams.get('route'), 'tickets/metrics');
        assert.equal(ticketsUrl.searchParams.get('site'), 'intl');
        assert.equal(ticketsUrl.searchParams.get('days'), '30');

        const verifyUrl = new URL(verifyCall.url, 'http://localhost');
        assert.equal(verifyUrl.searchParams.get('route'), 'settings/verify-monitor');
        assert.equal(verifyUrl.searchParams.get('taskPage'), '1');
        assert.equal(verifyUrl.searchParams.get('taskPageSize'), '6');
        assert.equal(verifyUrl.searchParams.get('failurePage'), '1');
        assert.equal(verifyUrl.searchParams.get('failurePageSize'), '4');
    });
});

test('analytics snapshot bundle preserves partial failures without failing the whole response', async () => {
    await withHandler({
        verifyMonitor: {
            statusCode: 403,
            body: {
                success: false,
                message: 'Forbidden'
            }
        }
    }, async ({ handler }) => {
        const res = createMockResponse();
        await handler({
            method: 'GET',
            url: '/api/admin?route=analytics/snapshot-bundle&site=cn',
            headers: {}
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.partial_failure_count, 1);
        assert.equal(payload.payments.ok, true);
        assert.equal(payload.verifyMonitor.ok, false);
        assert.equal(payload.verifyMonitor.statusCode, 403);
        assert.equal(payload.verifyMonitor.message, 'Forbidden');
    });
});

test('analytics snapshot bundle rejects non-GET methods', async () => {
    await withHandler({}, async ({ handler }) => {
        const res = createMockResponse();
        await handler({
            method: 'POST',
            url: '/api/admin?route=analytics/snapshot-bundle',
            headers: {}
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 405);
        assert.equal(payload.success, false);
        assert.equal(payload.message, 'Method not allowed');
    });
});
