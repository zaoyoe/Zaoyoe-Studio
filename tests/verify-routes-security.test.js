const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const Module = require('node:module');
const {
    buildHupijiaoHash
} = require('../api/_lib/payments/hupijiao');

function createQueryBuilder(executor) {
    const state = {
        mode: 'select',
        filters: [],
        order: null,
        limit: null,
        payload: null,
        single: false,
        maybeSingle: false
    };

    const builder = {
        select() {
            return builder;
        },
        eq(column, value) {
            state.filters.push({ op: 'eq', column, value });
            return builder;
        },
        in(column, values) {
            state.filters.push({ op: 'in', column, value: Array.isArray(values) ? values : [values] });
            return builder;
        },
        is(column, value) {
            state.filters.push({ op: 'is', column, value });
            return builder;
        },
        gte(column, value) {
            state.filters.push({ op: 'gte', column, value });
            return builder;
        },
        lt(column, value) {
            state.filters.push({ op: 'lt', column, value });
            return builder;
        },
        neq(column, value) {
            state.filters.push({ op: 'neq', column, value });
            return builder;
        },
        order(column, options = {}) {
            state.order = { column, options };
            return builder;
        },
        limit(value) {
            state.limit = value;
            return builder;
        },
        single() {
            state.single = true;
            return builder;
        },
        maybeSingle() {
            state.maybeSingle = true;
            return builder;
        },
        insert(payload) {
            state.mode = 'insert';
            state.payload = payload;
            return builder;
        },
        update(payload) {
            state.mode = 'update';
            state.payload = payload;
            return builder;
        },
        delete() {
            state.mode = 'delete';
            return builder;
        },
        then(resolve, reject) {
            return Promise.resolve(executor(state)).then(resolve, reject);
        },
        catch(reject) {
            return builder.then(undefined, reject);
        }
    };

    return builder;
}

function getFilterValue(query, column) {
    return query.filters.find((item) => item.column === column)?.value;
}

function applyCommonFilters(rows, query) {
    return rows.filter((row) => query.filters.every(({ op = 'eq', column, value }) => {
        const currentValue = row[column];

        if (op === 'eq') return currentValue === value;
        if (op === 'neq') return currentValue !== value;
        if (op === 'in') return Array.isArray(value) && value.includes(currentValue);
        if (op === 'is') return currentValue === value;
        if (op === 'gte') return String(currentValue || '') >= String(value || '');
        if (op === 'lt') return Number(currentValue) < Number(value);
        return false;
    }));
}

function createRpcResult(data, error = null) {
    return {
        single() {
            return Promise.resolve({ data, error });
        },
        then(resolve, reject) {
            return Promise.resolve({ data, error }).then(resolve, reject);
        },
        catch(reject) {
            return Promise.resolve({ data, error }).catch(reject);
        }
    };
}

async function withEnv(patch, callback) {
    const previous = {};

    for (const [key, value] of Object.entries(patch || {})) {
        previous[key] = process.env[key];
        if (value === undefined || value === null) {
            delete process.env[key];
        } else {
            process.env[key] = String(value);
        }
    }

    try {
        return await callback();
    } finally {
        for (const key of Object.keys(patch || {})) {
            if (previous[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = previous[key];
            }
        }
    }
}

function createSupabaseStub(state = {}) {
    const tokens = state.tokens || {};
    const verificationLogs = state.verificationLogs || [];
    const paymentEvents = state.paymentEvents || [];
    const paymentOrders = state.paymentOrders || [];
    const paymentCheckoutSessions = state.paymentCheckoutSessions || [];
    const pointsLedger = state.pointsLedger || [];
    const pointsPackages = state.pointsPackages || [];
    const adminSecretStore = state.adminSecretStore || [];
    const adminRoles = state.adminRoles || {};
    const permissions = state.permissions || {};
    const balances = state.balances || {};
    const verifySettings = state.verifySettings || {
        price_per_verify: 10,
        verify_api_key: 'verify-api-key',
        verify_api_base_url: 'https://verify.test'
    };
    const paymentChannels = state.paymentChannels || null;
    const rechargeOptions = state.rechargeOptions || null;
    const afdianProcessPaymentResult = state.afdianProcessPaymentResult || { status: 'pending_review', payment_order_id: null };
    const afdianProcessPaymentError = state.afdianProcessPaymentError || null;
    state.paymentEvents = paymentEvents;
    state.paymentOrders = paymentOrders;
    state.paymentCheckoutSessions = paymentCheckoutSessions;
    state.pointsLedger = pointsLedger;
    state.metrics = state.metrics || {};
    state.metrics.deductCalls = Number(state.metrics.deductCalls || 0);

    return {
        auth: {
            async getUser(token) {
                const user = tokens[String(token || '').trim()];
                if (user) {
                    return { data: { user }, error: null };
                }
                return { data: { user: null }, error: { message: 'Unauthorized' } };
            }
        },
        rpc(name, args = {}) {
            if (name === 'get_user_permissions') {
                return createRpcResult(
                    permissions[args.p_user_id] || {
                        is_admin: false,
                        is_super_admin: false
                    }
                );
            }

            if (name === 'fn_get_user_balance') {
                return createRpcResult({
                    total_balance: Number(balances[args.p_user_id] ?? 100)
                });
            }

            if (name === 'fn_process_afdian_payment') {
                return createRpcResult(afdianProcessPaymentResult, afdianProcessPaymentError);
            }

            if (name === 'fn_deduct_points_admin_site') {
                state.metrics.deductCalls += 1;
                pointsLedger.push({
                    id: `ledger-${pointsLedger.length + 1}`,
                    user_id: args.p_target_user_id,
                    amount: -Math.abs(Number(args.p_amount) || 0),
                    reference_id: args.p_reference_id,
                    site: args.p_site || null,
                    created_at: new Date().toISOString()
                });
                return createRpcResult({
                    deducted: Number(args.p_amount) || 0
                });
            }

            if (name === 'fn_deduct_points') {
                state.metrics.deductCalls += 1;
                pointsLedger.push({
                    id: `ledger-${pointsLedger.length + 1}`,
                    user_id: args.p_target_user_id,
                    amount: -Math.abs(Number(args.p_amount) || 0),
                    reference_id: args.p_reference_id,
                    site: null,
                    created_at: new Date().toISOString()
                });
                return createRpcResult({
                    deducted: Number(args.p_amount) || 0
                });
            }

            if (name === 'fn_recharge_points') {
                pointsLedger.push({
                    id: `ledger-${pointsLedger.length + 1}`,
                    user_id: args.target_user_id,
                    amount: Math.abs(Number(args.p_paid) || 0) + Math.abs(Number(args.p_bonus) || 0),
                    paid_points: Math.abs(Number(args.p_paid) || 0),
                    bonus_points: Math.abs(Number(args.p_bonus) || 0),
                    reference_id: args.p_reference_id,
                    site: args.p_site || null,
                    created_at: new Date().toISOString()
                });
                return createRpcResult({
                    paid: Number(args.p_paid) || 0,
                    bonus: Number(args.p_bonus) || 0
                });
            }

            if (name === 'fn_update_payment_checkout_session') {
                const row = paymentCheckoutSessions.find((item) => item.id === args.p_session_id) || null;
                if (row) {
                    Object.assign(row, args.p_patch || {});
                }
                return createRpcResult(row, null);
            }

            throw new Error(`Unexpected RPC in test stub: ${name}`);
        },
        from(table) {
            return createQueryBuilder(async (query) => {
                if (table === 'system_config' && query.mode === 'select') {
                    const configKey = getFilterValue(query, 'config_key');
                    const configKeys = query.filters.find((item) => item.column === 'config_key' && item.op === 'in')?.value || [];
                    if (configKey === 'verify_settings') {
                        const row = { config_value: verifySettings };
                        return {
                            data: query.single || query.maybeSingle ? row : [row],
                            error: null
                        };
                    }

                    if (configKeys.length) {
                        const rows = [];
                        if (configKeys.includes('payment_channels') && paymentChannels) {
                            rows.push({ config_key: 'payment_channels', config_value: paymentChannels });
                        }
                        if (configKeys.includes('recharge_options') && rechargeOptions) {
                            rows.push({ config_key: 'recharge_options', config_value: rechargeOptions });
                        }
                        return { data: rows, error: null };
                    }

                    return { data: null, error: null };
                }

                if (table === 'verification_logs' && query.mode === 'select') {
                    let rows = applyCommonFilters(verificationLogs, query);
                    if (query.order?.column === 'created_at') {
                        const ascending = query.order.options?.ascending !== false;
                        rows = [...rows].sort((left, right) => {
                            const leftTime = Date.parse(left.created_at || 0);
                            const rightTime = Date.parse(right.created_at || 0);
                            return ascending ? leftTime - rightTime : rightTime - leftTime;
                        });
                    }
                    if (Number.isFinite(query.limit)) {
                        rows = rows.slice(0, query.limit);
                    }

                    return { data: rows, error: null };
                }

                if (table === 'verification_logs' && query.mode === 'insert') {
                    const rows = Array.isArray(query.payload) ? query.payload : [query.payload];
                    const inserted = rows.map((row, index) => {
                        const nextRow = {
                            id: row.id || `verification-log-${verificationLogs.length + index + 1}`,
                            created_at: row.created_at || new Date().toISOString(),
                            ...row
                        };
                        verificationLogs.push(nextRow);
                        return nextRow;
                    });

                    return { data: inserted, error: null };
                }

                if (table === 'verification_logs' && query.mode === 'update') {
                    const matched = applyCommonFilters(verificationLogs, query);
                    matched.forEach((row) => {
                        Object.assign(row, query.payload || {});
                    });
                    return { data: matched, error: null };
                }

                if (table === 'admin_roles' && query.mode === 'select') {
                    let rows = (adminRoles[getFilterValue(query, 'user_id')] || []).map((role) => ({
                        role_name: role.role_name || 'admin',
                        expires_at: role.expires_at || null
                    }));

                    if (Number.isFinite(query.limit)) {
                        rows = rows.slice(0, query.limit);
                    }

                    return { data: rows, error: null };
                }

                if (table === 'admin_secret_store' && query.mode === 'select') {
                    const rows = applyCommonFilters(adminSecretStore, query);
                    const result = query.single || query.maybeSingle
                        ? (rows[0] || null)
                        : rows;
                    return { data: result, error: null };
                }

                if (table === 'points_packages' && query.mode === 'select') {
                    let rows = applyCommonFilters(pointsPackages, query);
                    if (query.order?.column) {
                        const ascending = query.order.options?.ascending !== false;
                        rows = [...rows].sort((left, right) => {
                            const leftValue = left[query.order.column];
                            const rightValue = right[query.order.column];
                            if (leftValue === rightValue) return 0;
                            if (leftValue == null) return 1;
                            if (rightValue == null) return -1;
                            return ascending
                                ? (leftValue > rightValue ? 1 : -1)
                                : (leftValue < rightValue ? 1 : -1);
                        });
                    }
                    if (Number.isFinite(query.limit)) {
                        rows = rows.slice(0, query.limit);
                    }

                    return {
                        data: query.single || query.maybeSingle ? (rows[0] || null) : rows,
                        error: null
                    };
                }

                if (table === 'payment_orders' && query.mode === 'select') {
                    let rows = applyCommonFilters(paymentOrders, query);
                    if (query.order?.column) {
                        const ascending = query.order.options?.ascending !== false;
                        rows = [...rows].sort((left, right) => {
                            const leftValue = left[query.order.column];
                            const rightValue = right[query.order.column];
                            if (leftValue === rightValue) return 0;
                            if (leftValue == null) return 1;
                            if (rightValue == null) return -1;
                            return ascending
                                ? (leftValue > rightValue ? 1 : -1)
                                : (leftValue < rightValue ? 1 : -1);
                        });
                    }
                    if (Number.isFinite(query.limit)) {
                        rows = rows.slice(0, query.limit);
                    }

                    return {
                        data: query.single || query.maybeSingle ? (rows[0] || null) : rows,
                        error: null
                    };
                }

                if (table === 'payment_orders' && query.mode === 'insert') {
                    const rows = Array.isArray(query.payload) ? query.payload : [query.payload];
                    const inserted = rows.map((row, index) => {
                        const nextRow = {
                            id: row.id || `payment-order-${paymentOrders.length + index + 1}`,
                            created_at: row.created_at || new Date().toISOString(),
                            updated_at: row.updated_at || row.created_at || new Date().toISOString(),
                            ...row
                        };
                        paymentOrders.push(nextRow);
                        return nextRow;
                    });

                    return {
                        data: query.single || query.maybeSingle ? (inserted[0] || null) : inserted,
                        error: null
                    };
                }

                if (table === 'payment_orders' && query.mode === 'update') {
                    const matched = applyCommonFilters(paymentOrders, query);
                    matched.forEach((row) => {
                        Object.assign(row, query.payload || {});
                    });
                    return {
                        data: query.single || query.maybeSingle ? (matched[0] || null) : matched,
                        error: null
                    };
                }

                if (table === 'payment_checkout_sessions' && query.mode === 'select') {
                    let rows = applyCommonFilters(paymentCheckoutSessions, query);
                    if (query.order?.column) {
                        const ascending = query.order.options?.ascending !== false;
                        rows = [...rows].sort((left, right) => {
                            const leftValue = left[query.order.column];
                            const rightValue = right[query.order.column];
                            if (leftValue === rightValue) return 0;
                            if (leftValue == null) return 1;
                            if (rightValue == null) return -1;
                            return ascending
                                ? (leftValue > rightValue ? 1 : -1)
                                : (leftValue < rightValue ? 1 : -1);
                        });
                    }
                    if (Number.isFinite(query.limit)) {
                        rows = rows.slice(0, query.limit);
                    }

                    return {
                        data: query.single || query.maybeSingle ? (rows[0] || null) : rows,
                        error: null
                    };
                }

                if (table === 'payment_checkout_sessions' && query.mode === 'update') {
                    const matched = applyCommonFilters(paymentCheckoutSessions, query);
                    matched.forEach((row) => {
                        Object.assign(row, query.payload || {});
                    });
                    return {
                        data: query.single || query.maybeSingle ? (matched[0] || null) : matched,
                        error: null
                    };
                }

                if (table === 'points_ledger' && query.mode === 'select') {
                    let rows = applyCommonFilters(pointsLedger, query);
                    if (query.order?.column) {
                        const ascending = query.order.options?.ascending !== false;
                        rows = [...rows].sort((left, right) => {
                            const leftValue = left[query.order.column];
                            const rightValue = right[query.order.column];
                            if (leftValue === rightValue) return 0;
                            if (leftValue == null) return 1;
                            if (rightValue == null) return -1;
                            return ascending
                                ? (leftValue > rightValue ? 1 : -1)
                                : (leftValue < rightValue ? 1 : -1);
                        });
                    }
                    if (Number.isFinite(query.limit)) {
                        rows = rows.slice(0, query.limit);
                    }

                    return {
                        data: query.single || query.maybeSingle ? (rows[0] || null) : rows,
                        error: null
                    };
                }

                if (table === 'payment_events' && query.mode === 'insert') {
                    const rows = Array.isArray(query.payload) ? query.payload : [query.payload];
                    const duplicateRow = rows.find((row) => paymentEvents.some((event) => event.event_key === row.event_key));
                    if (duplicateRow) {
                        return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
                    }

                    const inserted = rows.map((row, index) => {
                        const nextRow = {
                            id: row.id || `payment-event-${paymentEvents.length + index + 1}`,
                            created_at: row.created_at || new Date().toISOString(),
                            ...row
                        };
                        paymentEvents.push(nextRow);
                        return nextRow;
                    });

                    return { data: inserted, error: null };
                }

                if (table === 'payment_events' && query.mode === 'update') {
                    const matched = applyCommonFilters(paymentEvents, query);
                    matched.forEach((row) => {
                        Object.assign(row, query.payload || {});
                    });
                    return { data: matched, error: null };
                }

                if (table === 'payment_query_attempts' && query.mode === 'insert') {
                    return { data: null, error: null };
                }

                throw new Error(`Unexpected table access in test stub: ${table}/${query.mode}`);
            });
        }
    };
}

async function withTestServer(state, callback) {
    const serverPath = path.resolve(__dirname, '../server/index.js');
    const originalLoad = Module._load;
    const fakeSupabase = createSupabaseStub(state);

    delete require.cache[serverPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '@supabase/supabase-js') {
            return {
                createClient() {
                    return fakeSupabase;
                }
            };
        }

        return originalLoad.call(this, request, parent, isMain);
    };

    let serverModule;
    try {
        serverModule = require(serverPath);
    } finally {
        Module._load = originalLoad;
    }

    try {
        return await callback({ app: serverModule.app });
    } finally {
        delete require.cache[serverPath];
    }
}

function matchRoutePath(routePath, requestPath) {
    const routeSegments = String(routePath || '').split('/').filter(Boolean);
    const requestSegments = String(requestPath || '').split('/').filter(Boolean);
    if (routeSegments.length !== requestSegments.length) {
        return null;
    }

    const params = {};
    for (let index = 0; index < routeSegments.length; index += 1) {
        const routeSegment = routeSegments[index];
        const requestSegment = requestSegments[index];

        if (routeSegment.startsWith(':')) {
            params[routeSegment.slice(1)] = decodeURIComponent(requestSegment);
            continue;
        }

        if (routeSegment !== requestSegment) {
            return null;
        }
    }

    return params;
}

function findRouteHandler(app, method, pathname) {
    const router = app._router || app.router;
    const stack = Array.isArray(router?.stack) ? router.stack : [];

    for (const layer of stack) {
        const route = layer.route;
        if (!route) continue;
        if (!route.methods?.[String(method || '').toLowerCase()]) continue;

        const params = matchRoutePath(route.path, pathname);
        if (params) {
            const routeLayer = route.stack?.find((item) => typeof item.handle === 'function');
            if (routeLayer?.handle) {
                return {
                    handler: routeLayer.handle,
                    params
                };
            }
        }
    }

    throw new Error(`Route not found for ${method} ${pathname}`);
}

async function dispatchRoute(app, {
    method = 'GET',
    url = '/',
    headers = {},
    body = null,
    remoteAddress = ''
} = {}) {
    const parsedUrl = new URL(url, 'http://local.test');
    const normalizedHeaders = Object.fromEntries(
        Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), value])
    );
    const { handler, params } = findRouteHandler(app, method, parsedUrl.pathname);
    const req = {
        method,
        url,
        headers: normalizedHeaders,
        body,
        params,
        query: Object.fromEntries(parsedUrl.searchParams.entries()),
        socket: {
            remoteAddress
        },
        connection: {
            remoteAddress
        }
    };

    const responseState = {
        statusCode: 200,
        headers: {},
        body: ''
    };

    const res = {
        status(code) {
            responseState.statusCode = code;
            return res;
        },
        setHeader(name, value) {
            responseState.headers[String(name).toLowerCase()] = value;
            return res;
        },
        getHeaders() {
            return responseState.headers;
        },
        json(payload) {
            responseState.headers['content-type'] = 'application/json; charset=utf-8';
            responseState.body = JSON.stringify(payload);
            return res;
        },
        end(payload = '') {
            responseState.body = payload ? String(payload) : '';
            return res;
        }
    };

    await handler(req, res);

    return {
        status: responseState.statusCode,
        headers: responseState.headers,
        text: responseState.body,
        json() {
            return responseState.body ? JSON.parse(responseState.body) : {};
        }
    };
}

test('quota endpoint rejects unauthenticated external access', async () => {
    await withTestServer({}, async ({ app }) => {
        const response = await dispatchRoute(app, { url: '/api/quota' });
        const payload = response.json();

        assert.equal(response.status, 401);
        assert.equal(payload.code, 'unauthorized');
    });
});

test('quota endpoint requires admin privileges for authenticated external users', async () => {
    await withTestServer({
        tokens: {
            'member-token': { id: 'user-1', email: 'member@example.com' }
        }
    }, async ({ app }) => {
        const response = await dispatchRoute(app, {
            url: '/api/quota',
            headers: {
                Authorization: 'Bearer member-token',
                Host: 'zaoyoe-verify-server-production.up.railway.app'
            }
        });
        const payload = response.json();

        assert.equal(response.status, 403);
        assert.equal(payload.code, 'admin_required');
    });
});

test('quota endpoint allows admins and proxies upstream data', async () => {
    await withTestServer({
        tokens: {
            'admin-token': { id: 'admin-1', email: 'admin@example.com' }
        },
        permissions: {
            'admin-1': { is_admin: true, is_super_admin: false }
        }
    }, async ({ app }) => {
        const originalFetch = global.fetch;
        global.fetch = async (input) => {
            const url = String(input || '');
            if (url === 'https://verify.test/api/balance') {
                return new Response(JSON.stringify({
                    balance: 11,
                    total_used: 4,
                    cost_per_job: 1,
                    name: 'primary-key'
                }), {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
            }

            throw new Error(`Unexpected fetch URL in test: ${url}`);
        };

        try {
            const response = await dispatchRoute(app, {
                url: '/api/quota',
                headers: {
                    Authorization: 'Bearer admin-token',
                    Host: 'zaoyoe-verify-server-production.up.railway.app'
                }
            });
            const payload = response.json();

            assert.equal(response.status, 200);
            assert.equal(payload.success, true);
            assert.equal(payload.balance, 11);
            assert.equal(payload.total_used, 4);
            assert.equal(payload.key_name, 'primary-key');
        } finally {
            global.fetch = originalFetch;
        }
    });
});

test('quota endpoint rejects localhost access without admin auth', async () => {
    await withTestServer({}, async ({ app }) => {
        const response = await dispatchRoute(app, {
            url: '/api/quota',
            headers: {
                Host: 'localhost:3001'
            }
        });
        const payload = response.json();

        assert.equal(response.status, 401);
        assert.equal(payload.code, 'unauthorized');
    });
});

test('queue endpoint requires admin privileges', async () => {
    await withTestServer({
        tokens: {
            'member-token': { id: 'user-1', email: 'member@example.com' }
        }
    }, async ({ app }) => {
        const response = await dispatchRoute(app, {
            url: '/api/queue',
            headers: {
                Authorization: 'Bearer member-token'
            }
        });
        const payload = response.json();

        assert.equal(response.status, 403);
        assert.equal(payload.code, 'admin_required');
    });
});

test('queue endpoint rejects localhost access without admin auth', async () => {
    await withTestServer({}, async ({ app }) => {
        const response = await dispatchRoute(app, {
            url: '/api/queue',
            headers: {
                Host: '127.0.0.1:3001'
            }
        });
        const payload = response.json();

        assert.equal(response.status, 401);
        assert.equal(payload.code, 'unauthorized');
    });
});

test('queue endpoint allows admins and proxies upstream data', async () => {
    await withTestServer({
        tokens: {
            'admin-token': { id: 'admin-1', email: 'admin@example.com' }
        },
        permissions: {
            'admin-1': { is_admin: true, is_super_admin: false }
        }
    }, async ({ app }) => {
        const originalFetch = global.fetch;
        global.fetch = async (input, init) => {
            const url = String(input || '');
            if (url === 'https://verify.test/api/queue') {
                return new Response(JSON.stringify({
                    queue_size: 7,
                    running_jobs: 2
                }), {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
            }

            throw new Error(`Unexpected fetch URL in test: ${url}`);
        };

        try {
            const response = await dispatchRoute(app, {
                url: '/api/queue',
                headers: {
                    Authorization: 'Bearer admin-token'
                }
            });
            const payload = response.json();

            assert.equal(response.status, 200);
            assert.equal(payload.success, true);
            assert.equal(payload.queue_size, 7);
            assert.equal(payload.running_jobs, 2);
        } finally {
            global.fetch = originalFetch;
        }
    });
});

test('network request-context endpoint requires admin privileges', async () => {
    await withTestServer({
        tokens: {
            'member-token': { id: 'user-1', email: 'member@example.com' }
        }
    }, async ({ app }) => {
        const response = await dispatchRoute(app, {
            url: '/api/admin/network/request-context',
            headers: {
                Authorization: 'Bearer member-token'
            },
            remoteAddress: '10.0.0.2'
        });
        const payload = response.json();

        assert.equal(response.status, 403);
        assert.equal(payload.code, 'admin_required');
    });
});

test('network request-context endpoint returns proxy diagnostics for admins', async () => {
    await withTestServer({
        tokens: {
            'admin-token': { id: 'admin-1', email: 'admin@example.com' }
        },
        permissions: {
            'admin-1': { is_admin: true, is_super_admin: false }
        }
    }, async ({ app }) => {
        const response = await withEnv({
            TRUST_ALL_PROXIES: 'false',
            TRUSTED_PROXY_IPS: '10.0.0.0/8',
            AFDIAN_WEBHOOK_TRUSTED_PROXIES: '10.0.0.0/8',
            AFDIAN_WEBHOOK_ALLOWED_IPS: '198.51.100.0/24'
        }, async () => dispatchRoute(app, {
            url: '/api/admin/network/request-context',
            headers: {
                Authorization: 'Bearer admin-token',
                Host: 'zaoyoe-verify-server-production.up.railway.app',
                'x-forwarded-for': '198.51.100.23, 10.0.0.2',
                forwarded: 'for=198.51.100.23;proto=https'
            },
            remoteAddress: '10.0.0.2'
        }));
        const payload = response.json();

        assert.equal(response.status, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.request_context.app_proxy.socket_ip, '10.0.0.2');
        assert.equal(payload.request_context.app_proxy.resolved_client_ip, '198.51.100.23');
        assert.equal(payload.request_context.app_proxy.direct_peer_trusted, true);
        assert.equal(payload.request_context.app_proxy.used_forwarded_chain, true);
        assert.deepEqual(payload.request_context.app_proxy.trusted_proxies, ['10.0.0.0/8']);
        assert.equal(payload.request_context.afdian_webhook.allowlist_configured, true);
        assert.equal(payload.request_context.afdian_webhook.would_pass_allowlist, true);
        assert.equal(Array.isArray(payload.findings), true);
    });
});

test('network request-context endpoint flags mismatched trusted proxy rules', async () => {
    await withTestServer({
        tokens: {
            'admin-token': { id: 'admin-1', email: 'admin@example.com' }
        },
        permissions: {
            'admin-1': { is_admin: true, is_super_admin: false }
        }
    }, async ({ app }) => {
        const response = await withEnv({
            TRUST_ALL_PROXIES: 'false',
            TRUSTED_PROXY_IPS: '100.64.0.5/32',
            AFDIAN_WEBHOOK_TRUSTED_PROXIES: '100.64.0.5/32',
            AFDIAN_WEBHOOK_ALLOWED_IPS: '203.0.113.254/32'
        }, async () => dispatchRoute(app, {
            url: '/api/admin/network/request-context',
            headers: {
                Authorization: 'Bearer admin-token',
                Host: 'zaoyoe-verify-server-production.up.railway.app',
                'x-forwarded-for': '198.51.100.23',
                'x-real-ip': '198.51.100.23'
            },
            remoteAddress: '100.64.0.4'
        }));
        const payload = response.json();
        const findingCodes = payload.findings.map((finding) => finding.code);

        assert.equal(response.status, 200);
        assert.equal(payload.request_context.app_proxy.direct_peer_trusted, false);
        assert.equal(payload.request_context.app_proxy.used_forwarded_chain, false);
        assert.equal(payload.request_context.app_proxy.resolved_client_ip, '100.64.0.4');
        assert.equal(findingCodes.includes('proxy_trust_chain_mismatch'), true);
        assert.equal(findingCodes.includes('afdian_webhook_proxy_trust_mismatch'), true);
    });
});

test('verify status endpoint rejects task ids not owned by the authenticated user', async () => {
    await withTestServer({
        tokens: {
            'member-token': { id: 'user-1', email: 'member@example.com' }
        },
        verificationLogs: [
            {
                id: 'log-1',
                user_id: 'other-user',
                site: 'cn',
                verification_id: 'task-123',
                created_at: '2026-03-22T12:00:00.000Z',
                message: JSON.stringify({ job_id: 'task-123', email: 'other@example.com' })
            }
        ]
    }, async ({ app }) => {
        const response = await dispatchRoute(app, {
            url: '/api/verify/status/task-123',
            headers: {
                Authorization: 'Bearer member-token'
            }
        });
        const payload = response.json();

        assert.equal(response.status, 404);
        assert.equal(payload.code, 'job_not_found');
    });
});

test('verify submit binds tracked job ownership to the authenticated user', async () => {
    const state = {
        tokens: {
            'member-token': { id: 'user-1', email: 'member@example.com' }
        },
        balances: {
            'user-1': 100
        },
        verificationLogs: []
    };

    await withTestServer(state, async ({ app }) => {
        const originalFetch = global.fetch;
        global.fetch = async (input, init) => {
            const url = String(input || '');
            if (url === 'https://verify.test/api/jobs') {
                return new Response(JSON.stringify({
                    job_id: 'job-queued-1',
                    status: 'queued',
                    queue_position: 3,
                    estimated_wait_seconds: 25
                }), {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
            }

            throw new Error(`Unexpected fetch URL in test: ${url}`);
        };

        try {
            const response = await dispatchRoute(app, {
                method: 'POST',
                url: '/api/verify',
                headers: {
                    Authorization: 'Bearer member-token'
                },
                body: {
                    email: 'member@example.com',
                    password: 'pw',
                    totpSecret: 'totp-secret',
                    priority: 1,
                    userId: 'victim-user',
                    site: 'intl'
                }
            });
            const payload = response.json();

            assert.equal(response.status, 200);
            assert.equal(payload.success, true);
            assert.equal(payload.job_id, 'job-queued-1');
            assert.equal(state.verificationLogs.length, 1);
            assert.equal(state.verificationLogs[0].user_id, 'user-1');
            assert.equal(state.verificationLogs[0].site, 'cn');
            assert.equal(state.verificationLogs[0].verification_id, 'job-queued-1');
        } finally {
            global.fetch = originalFetch;
        }
    });
});

test('afdian webhook duplicate payload is ignored after the first event is recorded', async () => {
    const state = {
        paymentEvents: []
    };

    await withTestServer(state, async ({ app }) => {
        const payload = {
            ec: 500,
            em: 'upstream retry hint',
            data: {
                type: 'order',
                order: {
                    out_trade_no: 'AFD-ORDER-1',
                    status: 2,
                    total_amount: '5.00'
                }
            }
        };

        const firstResponse = await dispatchRoute(app, {
            method: 'POST',
            url: '/api/afdian/webhook',
            body: payload
        });
        const firstJson = firstResponse.json();

        const secondResponse = await dispatchRoute(app, {
            method: 'POST',
            url: '/api/afdian/webhook',
            body: payload
        });
        const secondJson = secondResponse.json();

        assert.equal(firstResponse.status, 200);
        assert.deepEqual(firstJson, { ec: 200, em: '' });
        assert.equal(secondResponse.status, 200);
        assert.deepEqual(secondJson, { ec: 200, em: '' });
        assert.equal(state.paymentEvents.length, 1);
        assert.equal(state.paymentEvents[0].provider_order_no, 'AFD-ORDER-1');
        assert.equal(state.paymentEvents[0].processing_result, 'ignored_non_success_ec');
    });
});

test('afdian webhook rejects missing signatures and records the failure', async () => {
    const state = {
        paymentEvents: []
    };

    await withTestServer(state, async ({ app }) => {
        const response = await withEnv({
            AFDIAN_TOKEN: 'afdian-secret'
        }, async () => dispatchRoute(app, {
            method: 'POST',
            url: '/api/afdian/webhook',
            body: {
                ec: 200,
                data: {
                    type: 'order',
                    order: {
                        out_trade_no: 'AFD-MISS-SIGN',
                        status: 2,
                        total_amount: '5.00'
                    }
                }
            }
        }));
        const payload = response.json();

        assert.equal(response.status, 401);
        assert.deepEqual(payload, { ec: 401, em: 'missing signature' });
        assert.equal(state.paymentEvents.length, 1);
        assert.equal(state.paymentEvents[0].processing_result, 'missing_signature');
        assert.equal(state.paymentEvents[0].response_status, 401);
    });
});

test('afdian webhook rejects invalid signatures after processing metadata is recorded', async () => {
    const state = {
        paymentEvents: [],
        paymentOrders: [
            {
                id: 'pay-order-signature',
                provider: 'afdian',
                provider_order_no: 'AFD-BAD-SIGN',
                checkout_session_id: null
            }
        ]
    };

    await withTestServer(state, async ({ app }) => {
        const response = await withEnv({
            AFDIAN_TOKEN: 'afdian-secret'
        }, async () => dispatchRoute(app, {
            method: 'POST',
            url: '/api/afdian/webhook',
            body: {
                ec: 200,
                sign: 'bad-signature',
                data: {
                    type: 'order',
                    order: {
                        out_trade_no: 'AFD-BAD-SIGN',
                        status: 2,
                        total_amount: '20.00'
                    }
                }
            }
        }));
        const payload = response.json();

        assert.equal(response.status, 401);
        assert.deepEqual(payload, { ec: 401, em: 'invalid signature' });
        assert.equal(state.paymentEvents.length, 1);
        assert.equal(state.paymentEvents[0].signature_valid, false);
        assert.equal(state.paymentEvents[0].amount_valid, true);
        assert.equal(state.paymentEvents[0].processing_result, 'pending_review');
        assert.equal(state.paymentEvents[0].error_message, 'signature_mismatch');
        assert.equal(state.paymentEvents[0].response_status, 401);
    });
});

test('afdian webhook keeps amount mismatches in pending review', async () => {
    const state = {
        paymentEvents: [],
        paymentOrders: [
            {
                id: 'pay-order-mismatch',
                provider: 'afdian',
                provider_order_no: 'AFD-AMOUNT-MISMATCH',
                checkout_session_id: null
            }
        ],
        pointsPackages: [
            {
                id: 'pkg-1',
                name: 'Test Package',
                points_amount: 100,
                bonus_points: 0,
                price_cny: 10,
                sku_id: 'sku-10',
                is_active: true
            }
        ],
        afdianProcessPaymentResult: {
            status: 'amount_mismatch',
            payment_order_id: null
        }
    };

    await withTestServer(state, async ({ app }) => {
        const payloadData = {
            type: 'order',
            order: {
                out_trade_no: 'AFD-AMOUNT-MISMATCH',
                status: 2,
                plan_id: 'sku-10',
                total_amount: '12.00'
            }
        };
        const sign = crypto
            .createHash('md5')
            .update(`afdian-secret${JSON.stringify(payloadData)}`)
            .digest('hex');

        const response = await withEnv({
            AFDIAN_TOKEN: 'afdian-secret'
        }, async () => dispatchRoute(app, {
            method: 'POST',
            url: '/api/afdian/webhook',
            body: {
                ec: 200,
                sign,
                data: payloadData
            }
        }));
        const payload = response.json();

        assert.equal(response.status, 200);
        assert.deepEqual(payload, { ec: 200, em: 'pending review' });
        assert.equal(state.paymentEvents.length, 1);
        assert.equal(state.paymentEvents[0].signature_valid, true);
        assert.equal(state.paymentEvents[0].amount_valid, false);
        assert.equal(state.paymentEvents[0].processing_result, 'amount_mismatch');
        assert.equal(state.paymentEvents[0].error_message, 'amount_mismatch_expected_10');
        assert.equal(state.paymentEvents[0].response_status, 200);
    });
});

test('afdian webhook marks process_rpc_failed when fn_process_afdian_payment errors', async () => {
    const state = {
        paymentEvents: [],
        paymentOrders: [
            {
                id: 'pay-order-rpc-fail',
                provider: 'afdian',
                provider_order_no: 'AFD-RPC-FAIL',
                checkout_session_id: null
            }
        ],
        pointsPackages: [
            {
                id: 'pkg-2',
                name: 'RPC Fail Package',
                points_amount: 200,
                bonus_points: 0,
                price_cny: 20,
                sku_id: 'sku-20',
                is_active: true
            }
        ],
        afdianProcessPaymentResult: null,
        afdianProcessPaymentError: {
            message: 'fn_process_afdian_payment exploded'
        }
    };

    await withTestServer(state, async ({ app }) => {
        const payloadData = {
            type: 'order',
            order: {
                out_trade_no: 'AFD-RPC-FAIL',
                status: 2,
                plan_id: 'sku-20',
                total_amount: '20.00'
            }
        };
        const sign = crypto
            .createHash('md5')
            .update(`afdian-secret${JSON.stringify(payloadData)}`)
            .digest('hex');

        const response = await withEnv({
            AFDIAN_TOKEN: 'afdian-secret'
        }, async () => dispatchRoute(app, {
            method: 'POST',
            url: '/api/afdian/webhook',
            body: {
                ec: 200,
                sign,
                data: payloadData
            }
        }));
        const payload = response.json();

        assert.equal(response.status, 500);
        assert.deepEqual(payload, { ec: 500, em: 'internal error' });
        assert.equal(state.paymentEvents.length, 1);
        assert.equal(state.paymentEvents[0].processing_result, 'process_rpc_failed');
        assert.equal(state.paymentEvents[0].error_message, 'fn_process_afdian_payment exploded');
        assert.equal(state.paymentEvents[0].response_status, 500);
    });
});

test('afdian webhook rejects requests outside the configured source IP allowlist', async () => {
    const state = {
        paymentEvents: []
    };

    await withTestServer(state, async ({ app }) => {
        const response = await withEnv({
            AFDIAN_WEBHOOK_ALLOWED_IPS: '203.0.113.0/24'
        }, async () => dispatchRoute(app, {
            method: 'POST',
            url: '/api/afdian/webhook',
            headers: {
                'x-forwarded-for': '198.51.100.22'
            },
            body: {
                ec: 200,
                sign: 'ignored',
                data: {
                    type: 'order',
                    order: {
                        out_trade_no: 'AFD-IP-BLOCKED',
                        status: 2,
                        total_amount: '5.00'
                    }
                }
            }
        }));
        const payload = response.json();

        assert.equal(response.status, 403);
        assert.deepEqual(payload, { ec: 403, em: 'forbidden' });
        assert.equal(state.paymentEvents.length, 0);
    });
});

test('hupijiao webhook verifies the signature and auto-credits the linked order', async () => {
    const state = {
        paymentEvents: [],
        paymentOrders: [
            {
                id: 'pay-order-hj-1',
                provider: 'hupijiao',
                provider_order_no: 'HJ_ORDER_1',
                checkout_session_id: 'checkout-hj-1',
                user_id: 'user-1',
                site: 'cn',
                package_id: 'pkg-1',
                package_name: '虎皮椒套餐',
                expected_amount: 9.9,
                paid_amount: null,
                points_amount: 110,
                status: 'pending',
                sign_verified: false,
                amount_verified: false,
                provider_metadata: {},
                raw_payload: {
                    request: {
                        points_amount: 100,
                        bonus_points: 10
                    }
                },
                created_at: '2026-03-23T00:00:00.000Z'
            }
        ],
        paymentCheckoutSessions: [
            {
                id: 'checkout-hj-1',
                session_key: 'PCS_HUPIJIAO_TEST_1',
                provider: 'hupijiao',
                user_id: 'user-1',
                site: 'cn',
                package_id: 'pkg-1',
                package_name: '虎皮椒套餐',
                requested_points: 100,
                bonus_points: 10,
                granted_points: 110,
                expected_amount: 9.9,
                status: 'redirect_ready',
                payment_order_id: null,
                provider_metadata: {
                    provider_order_no: 'HJ_ORDER_1'
                },
                created_at: '2026-03-23T00:00:00.000Z'
            }
        ]
    };

    await withTestServer(state, async ({ app }) => {
        const payload = {
            trade_order_id: 'HJ_ORDER_1',
            total_fee: '9.90',
            transaction_id: 'TXN_HJ_1',
            open_order_id: 'OPEN_HJ_1',
            order_title: '虎皮椒套餐',
            status: 'OD',
            appid: 'appid-123',
            time: '1742710999',
            nonce_str: 'nonce_hj_1',
            attach: JSON.stringify({
                provider: 'hupijiao',
                user_id: 'user-1',
                site: 'cn',
                checkout_session_id: 'checkout-hj-1',
                checkout_session_key: 'PCS_HUPIJIAO_TEST_1',
                package_id: 'pkg-1',
                package_name: '虎皮椒套餐',
                paid_points: 100,
                bonus_points: 10,
                granted_points: 110,
                expected_amount: 9.9,
                charge_type: 'package'
            })
        };
        payload.hash = buildHupijiaoHash(payload, 'secret-123');

        const response = await withEnv({
            HUPIJIAO_SECRET_KEY: 'secret-123'
        }, async () => dispatchRoute(app, {
            method: 'POST',
            url: '/api/payments/hupijiao/webhook',
            body: payload
        }));

        const paymentOrder = state.paymentOrders.find((item) => item.id === 'pay-order-hj-1');
        const checkoutSession = state.paymentCheckoutSessions.find((item) => item.id === 'checkout-hj-1');

        assert.equal(response.status, 200);
        assert.equal(response.text, 'success');
        assert.equal(state.paymentEvents.length, 1);
        assert.equal(state.paymentEvents[0].processing_result, 'processed_paid');
        assert.equal(state.paymentEvents[0].signature_valid, true);
        assert.equal(state.paymentEvents[0].amount_valid, true);
        assert.equal(state.pointsLedger.length, 1);
        assert.equal(state.pointsLedger[0].user_id, 'user-1');
        assert.equal(state.pointsLedger[0].reference_id, 'hupijiao_HJ_ORDER_1');
        assert.equal(paymentOrder.status, 'redeemed');
        assert.equal(paymentOrder.sign_verified, true);
        assert.equal(paymentOrder.amount_verified, true);
        assert.equal(paymentOrder.provider_metadata.transaction_id, 'TXN_HJ_1');
        assert.equal(checkoutSession.status, 'completed');
        assert.equal(checkoutSession.payment_order_id, 'pay-order-hj-1');
    });
});

test('afdian query endpoint returns 429 when a single client exceeds the rate limit window', async () => {
    await withTestServer({}, async ({ app }) => {
        const firstResponse = await withEnv({
            AFDIAN_QUERY_RATE_LIMIT_MAX: '1',
            AFDIAN_QUERY_RATE_LIMIT_WINDOW_MS: '60000'
        }, async () => dispatchRoute(app, {
            method: 'POST',
            url: '/api/afdian/query',
            headers: {
                'x-forwarded-for': '203.0.113.40'
            },
            body: {
                order_no: 'ORDER-1'
            }
        }));

        const secondResponse = await withEnv({
            AFDIAN_QUERY_RATE_LIMIT_MAX: '1',
            AFDIAN_QUERY_RATE_LIMIT_WINDOW_MS: '60000'
        }, async () => dispatchRoute(app, {
            method: 'POST',
            url: '/api/afdian/query',
            headers: {
                'x-forwarded-for': '203.0.113.40'
            },
            body: {
                order_no: 'ORDER-1'
            }
        }));
        const secondPayload = secondResponse.json();

        assert.equal(firstResponse.status, 401);
        assert.equal(secondResponse.status, 429);
        assert.equal(secondPayload.success, false);
        assert.equal(secondPayload.code, 'rate_limited');
        assert.equal(secondPayload.retry_after_seconds > 0, true);
    });
});

test('verify success polling deducts points only once per job id', async () => {
    const state = {
        tokens: {
            'member-token': { id: 'user-1', email: 'member@example.com' }
        },
        balances: {
            'user-1': 100
        },
        verificationLogs: [
            {
                id: 'verify-job-success-1',
                user_id: 'user-1',
                site: 'cn',
                verification_id: 'job-success-1',
                status: 'queued',
                points_deducted: 0,
                created_at: '2026-03-22T12:00:00.000Z',
                message: JSON.stringify({
                    kind: 'google_one_job',
                    job_id: 'job-success-1',
                    email: 'member@example.com',
                    raw_status: 'queued'
                })
            }
        ],
        pointsLedger: []
    };

    await withTestServer(state, async ({ app }) => {
        const originalFetch = global.fetch;
        global.fetch = async (input) => {
            const url = String(input || '');
            if (url === 'https://verify.test/api/jobs/job-success-1') {
                return new Response(JSON.stringify({
                    job_id: 'job-success-1',
                    status: 'success',
                    stage: 3,
                    total_stages: 3,
                    stage_label: 'done',
                    url: 'https://example.com/result',
                    elapsed_seconds: 18
                }), {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
            }

            throw new Error(`Unexpected fetch URL in test: ${url}`);
        };

        try {
            const firstResponse = await dispatchRoute(app, {
                url: '/api/verify/status/job-success-1',
                headers: {
                    Authorization: 'Bearer member-token'
                }
            });
            const firstPayload = firstResponse.json();

            const secondResponse = await dispatchRoute(app, {
                url: '/api/verify/status/job-success-1',
                headers: {
                    Authorization: 'Bearer member-token'
                }
            });
            const secondPayload = secondResponse.json();

            assert.equal(firstResponse.status, 200);
            assert.equal(secondResponse.status, 200);
            assert.equal(firstPayload.success, true);
            assert.equal(secondPayload.success, true);
            assert.equal(firstPayload.pointsDeducted, 10);
            assert.equal(secondPayload.pointsDeducted, 10);
            assert.equal(state.metrics.deductCalls, 1);
            assert.equal(state.pointsLedger.length, 1);
            assert.equal(state.pointsLedger[0].reference_id, 'job-success-1');
            assert.equal(state.pointsLedger[0].site, 'cn');
            assert.equal(state.verificationLogs[0].status, 'success');
            assert.equal(state.verificationLogs[0].points_deducted, 10);
        } finally {
            global.fetch = originalFetch;
        }
    });
});
