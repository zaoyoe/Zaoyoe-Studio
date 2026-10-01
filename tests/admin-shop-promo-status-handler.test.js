'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

function createMockResponse() {
    const state = { statusCode: 200, headers: {}, body: '' };
    return {
        status(code) { state.statusCode = code; return this; },
        setHeader(name, value) { state.headers[name] = value; return this; },
        end(payload = '') { state.body = String(payload || ''); },
        json() { return state.body ? JSON.parse(state.body) : {}; },
        get statusCode() { return state.statusCode; },
        get headers() { return state.headers; }
    };
}

function getShanghaiDate(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

async function withPromoStatusHandler(initialState, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/shop/promo-status.js');
    const originalLoad = Module._load;
    const state = {
        adminOptions: [],
        tableCalls: [],
        adminError: null,
        serviceRoleAvailable: true,
        results: {
            guest_shop_promo_breaker: {
                data: { id: 1, state: 'closed', opened_at: null, closed_at: '2026-09-22T01:00:00Z' }, error: null
            },
            guest_shop_promo_budget: {
                data: [
                    { site: 'cn', enabled: true, daily_budget_cny: '20.00', spent_cny: '2.00', budget_date: getShanghaiDate() },
                    { site: 'intl', enabled: false, daily_budget_cny: '3.50', spent_cny: '1.00', budget_date: '2020-01-01' }
                ], error: null
            },
            guest_shop_promo_breaker_events: {
                data: [{
                    id: 91,
                    kind: 'manual_close',
                    site: 'cn',
                    occurred_at: '2026-09-22T01:00:00Z',
                    detail: { email: 'must-not-leak@example.test', buyer_contact_hash: 'private-hash' },
                    claim_secret_hash: 'private-claim'
                }],
                error: null
            }
        },
        ...initialState
    };

    const supabase = {
        from(table) {
            const call = { table, operations: [] };
            state.tableCalls.push(call);
            const builder = {};
            for (const method of ['select', 'eq', 'in', 'order', 'limit']) {
                builder[method] = (...args) => {
                    call.operations.push({ method, args });
                    return builder;
                };
            }
            builder.maybeSingle = () => {
                call.operations.push({ method: 'maybeSingle', args: [] });
                return Promise.resolve(state.results[table]);
            };
            builder.then = (resolve, reject) => {
                const result = state.results[table];
                return Promise.resolve(result).then(resolve, reject);
            };
            return builder;
        }
    };

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                requireAdmin: async (_req, options) => {
                    state.adminOptions.push(options);
                    if (state.adminError) throw state.adminError;
                    return { adminSupabase: state.serviceRoleAvailable ? supabase : null };
                },
                sendJson(res, status, payload) {
                    return res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8').end(JSON.stringify(payload));
                }
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        const handler = require(handlerPath);
        await callback({ handler, state });
    } finally {
        Module._load = originalLoad;
        delete require.cache[handlerPath];
    }
}

test('promo status requires shop.manage before querying service-role tables', async () => {
    const forbidden = new Error('Admin access required');
    forbidden.statusCode = 403;
    forbidden.code = 'admin_permission_required';
    await withPromoStatusHandler({ adminError: forbidden }, async ({ handler, state }) => {
        const response = createMockResponse();
        await handler({ method: 'GET' }, response);
        assert.equal(response.statusCode, 403);
        assert.deepEqual(state.adminOptions, [{ permission: 'shop.manage' }]);
        assert.equal(state.tableCalls.length, 0);
    });
});

test('promo status uses exact column allowlists and maps CN/INTL plus safe event fields', async () => {
    await withPromoStatusHandler({}, async ({ handler, state }) => {
        const response = createMockResponse();
        await handler({ method: 'GET' }, response);
        const payload = response.json();

        assert.equal(response.statusCode, 200);
        assert.equal(response.headers['Cache-Control'], 'no-store, max-age=0');
        assert.equal(payload.available, true);
        assert.equal(payload.breaker.state, 'closed');
        assert.equal(payload.budgets.length, 2);
        assert.deepEqual(payload.budgets.map(({ site }) => site), ['cn', 'intl']);
        assert.deepEqual(payload.budgets.map(({ spent_cny, remaining_cny, stale_date }) => ({ spent_cny, remaining_cny, stale_date })), [
            { spent_cny: 2, remaining_cny: 18, stale_date: false },
            { spent_cny: 0, remaining_cny: 3.5, stale_date: true }
        ]);
        assert.deepEqual(payload.events, [{
            id: 91,
            kind: 'manual_close',
            site: 'cn',
            occurred_at: '2026-09-22T01:00:00.000Z'
        }]);
        assert.equal(JSON.stringify(payload).includes('must-not-leak'), false);
        assert.equal(JSON.stringify(payload).includes('private-hash'), false);
        assert.equal(JSON.stringify(payload).includes('claim_secret'), false);
        assert.deepEqual(state.tableCalls.map((call) => [
            call.table,
            call.operations.find((operation) => operation.method === 'select')?.args[0]
        ]), [
            ['guest_shop_promo_breaker', 'id,state,opened_at,closed_at'],
            ['guest_shop_promo_budget', 'site,enabled,daily_budget_cny,spent_cny,budget_date'],
            ['guest_shop_promo_breaker_events', 'id,kind,site,occurred_at']
        ]);
        const eventCall = state.tableCalls.find((call) => call.table === 'guest_shop_promo_breaker_events');
        assert.deepEqual(eventCall.operations.find((operation) => operation.method === 'order')?.args, ['occurred_at', { ascending: false }]);
        assert.deepEqual(eventCall.operations.find((operation) => operation.method === 'limit')?.args, [10]);
    });
});

test('missing rows, service-role access, and database errors fail closed without stale status', async (t) => {
    const cases = [
        ['missing breaker row', { guest_shop_promo_breaker: { data: null, error: null } }],
        ['missing CN or INTL budget row', { guest_shop_promo_budget: { data: [], error: null } }],
        ['events table/read failure', { guest_shop_promo_breaker_events: { data: null, error: { message: 'private database detail' } } }]
    ];
    for (const [name, results] of cases) {
        await t.test(name, async () => {
            await withPromoStatusHandler({ results: { ...defaultResults(), ...results } }, async ({ handler }) => {
                const response = createMockResponse();
                await handler({ method: 'GET' }, response);
                const payload = response.json();
                assert.equal(response.statusCode, 503);
                assert.equal(payload.available, false);
                assert.equal(payload.breaker, undefined);
                assert.equal(JSON.stringify(payload).includes('private database'), false);
            });
        });
    }
    await withPromoStatusHandler({ serviceRoleAvailable: false }, async ({ handler }) => {
        const response = createMockResponse();
        await handler({ method: 'GET' }, response);
        assert.equal(response.statusCode, 503);
        assert.equal(response.json().available, false);
    });
});

function defaultResults() {
    return {
        guest_shop_promo_breaker: {
            data: { id: 1, state: 'closed', opened_at: null, closed_at: null }, error: null
        },
        guest_shop_promo_budget: {
            data: [
                { site: 'cn', enabled: true, daily_budget_cny: 20, spent_cny: 0, budget_date: getShanghaiDate() },
                { site: 'intl', enabled: false, daily_budget_cny: 0, spent_cny: 0, budget_date: getShanghaiDate() }
            ], error: null
        },
        guest_shop_promo_breaker_events: { data: [], error: null }
    };
}

test('promo status rejects every non-GET method before auth or database access', async () => {
    await withPromoStatusHandler({}, async ({ handler, state }) => {
        const response = createMockResponse();
        await handler({ method: 'POST' }, response);
        assert.equal(response.statusCode, 405);
        assert.equal(response.headers.Allow, 'GET');
        assert.equal(response.headers['Cache-Control'], 'no-store, max-age=0');
        assert.equal(state.adminOptions.length, 0);
        assert.equal(state.tableCalls.length, 0);
        const missingMethodResponse = createMockResponse();
        await handler({}, missingMethodResponse);
        assert.equal(missingMethodResponse.statusCode, 405);
    });
});

test('Admin Studio exposes a read-only promo status panel and registers its GET route', () => {
    const apiSource = fs.readFileSync(path.resolve(__dirname, '../api/admin.js'), 'utf8');
    const handlerSource = fs.readFileSync(path.resolve(__dirname, '../server/api-handlers/admin/shop/promo-status.js'), 'utf8');
    const html = fs.readFileSync(path.resolve(__dirname, '../admin-studio.html'), 'utf8');
    const script = fs.readFileSync(path.resolve(__dirname, '../js/admin-shop.js'), 'utf8');
    const styles = fs.readFileSync(path.resolve(__dirname, '../css/admin-studio-page.css'), 'utf8');

    assert.match(apiSource, /shopPromoStatusHandler\s*=\s*require\(['"]\.\.\/server\/api-handlers\/admin\/shop\/promo-status['"]\)/);
    assert.match(apiSource, /['"]shop\/promo-status['"]\s*:\s*shopPromoStatusHandler/);
    assert.match(handlerSource, /requireAdmin\(req, \{ permission: 'shop\.manage' \}\)/);
    assert.match(html, /游客促销安全状态[\s\S]{0,900}guestPromoStatusEvents/);
    assert.match(script, /buildAdminShopUrl\('shop\/promo-status'\)/);
    assert.match(html, /data-shop-action="guest-promo-status-refresh"/);
    assert.match(styles, /\.shop-guest-promo-status\s*\{/);
    assert.doesNotMatch(script.match(/loadGuestPromoStatus: async function \(\) \{[\s\S]*?\n    \},/)?.[0] || '', /method:\s*['"]POST['"]|\.rpc\(|\.from\(/);
});
