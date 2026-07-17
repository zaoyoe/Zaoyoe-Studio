const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const Module = require('node:module');
const {
    VERIFY_MONITOR_INTERNAL_HEADER_NAME
} = require('../api/_lib/verify-monitor-internal-access');
const {
    buildHupijiaoHash
} = require('../api/_lib/payments/hupijiao');
const {
    issuePaymentIntentClaimToken
} = require('../api/_lib/payments/orders');

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
    const afdianOrders = state.afdianOrders || [];
    const pointsLedger = state.pointsLedger || [];
    const pointsPackages = state.pointsPackages || [];
    const discountCodes = state.discountCodes || [];
    const discountUserAssets = state.discountUserAssets || [];
    const rateLimitBuckets = state.rateLimitBuckets || new Map();
    const adminSecretStore = state.adminSecretStore || [];
    const adminRoles = state.adminRoles || {};
    const permissions = state.permissions || {};
    const balances = state.balances || {};
    const verifySettings = state.verifySettings || {
        price_per_verify: 10,
        price_per_verify_extract: 10,
        price_per_verify_full: 20,
        verify_api_key: 'verify-api-key',
        verify_api_base_url: 'https://verify.test'
    };
    const paymentChannels = state.paymentChannels || null;
    const rechargeOptions = state.rechargeOptions || null;
    const discountTriggerRules = state.discountTriggerRules || null;
    const afdianProcessPaymentResult = state.afdianProcessPaymentResult || { status: 'pending_review', payment_order_id: null };
    const afdianProcessPaymentError = state.afdianProcessPaymentError || null;
    const rpcCalls = state.rpcCalls || [];
    state.paymentEvents = paymentEvents;
    state.paymentOrders = paymentOrders;
    state.paymentCheckoutSessions = paymentCheckoutSessions;
    state.afdianOrders = afdianOrders;
    state.pointsLedger = pointsLedger;
    state.discountCodes = discountCodes;
    state.discountUserAssets = discountUserAssets;
    state.rateLimitBuckets = rateLimitBuckets;
    state.rpcCalls = rpcCalls;
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
            rpcCalls.push({ name, args });
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

            if (name === 'fn_deduct_points_admin_site_with_breakdown' || name === 'fn_deduct_points_admin_site') {
                state.metrics.deductCalls += 1;
                const deducted = state.deductedAmountOverride === undefined
                    ? Number(args.p_amount) || 0
                    : Number(state.deductedAmountOverride) || 0;
                if (deducted > 0) {
                    pointsLedger.push({
                        id: `ledger-${pointsLedger.length + 1}`,
                        user_id: args.p_target_user_id,
                        amount: -Math.abs(deducted),
                        reference_id: args.p_reference_id,
                        site: args.p_site || null,
                        created_at: new Date().toISOString()
                    });
                }
                return createRpcResult({
                    deducted
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

            if (name === 'take_rate_limit_token') {
                const key = String(args.p_key || '').trim();
                const limit = Math.max(1, Number(args.p_limit) || 1);
                const windowMs = Math.max(1000, Number(args.p_window_ms) || 60_000);
                const now = Number.isFinite(Date.parse(args.p_now))
                    ? Date.parse(args.p_now)
                    : Date.now();

                if (!key) {
                    return createRpcResult({
                        allowed: true,
                        limit_value: limit,
                        remaining: Math.max(0, limit - 1),
                        reset_at: new Date(now + windowMs).toISOString(),
                        retry_after_seconds: Math.max(1, Math.ceil(windowMs / 1000)),
                        hit_count: 1
                    });
                }

                let entry = rateLimitBuckets.get(key);
                if (!entry || entry.resetAt <= now) {
                    entry = {
                        count: 0,
                        resetAt: now + windowMs
                    };
                }

                let allowed = true;
                if (entry.count >= limit) {
                    allowed = false;
                } else {
                    entry.count += 1;
                }

                rateLimitBuckets.set(key, entry);

                return createRpcResult({
                    allowed,
                    limit_value: limit,
                    remaining: allowed ? Math.max(0, limit - entry.count) : 0,
                    reset_at: new Date(entry.resetAt).toISOString(),
                    retry_after_seconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
                    hit_count: entry.count
                });
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

                    if (configKey === 'discount_trigger_rules' && discountTriggerRules) {
                        const row = { config_key: 'discount_trigger_rules', config_value: discountTriggerRules };
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
                        if (configKeys.includes('discount_trigger_rules') && discountTriggerRules) {
                            rows.push({ config_key: 'discount_trigger_rules', config_value: discountTriggerRules });
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

                if (table === 'discount_codes' && query.mode === 'select') {
                    let rows = applyCommonFilters(discountCodes, query);
                    if (Number.isFinite(query.limit)) {
                        rows = rows.slice(0, query.limit);
                    }
                    return {
                        data: query.single || query.maybeSingle ? (rows[0] || null) : rows,
                        error: null
                    };
                }

                if (table === 'discount_user_assets' && query.mode === 'select') {
                    let rows = applyCommonFilters(discountUserAssets, query);
                    if (Number.isFinite(query.limit)) {
                        rows = rows.slice(0, query.limit);
                    }
                    return {
                        data: query.single || query.maybeSingle ? (rows[0] || null) : rows,
                        error: null
                    };
                }

                if (table === 'discount_user_assets' && query.mode === 'insert') {
                    const rows = Array.isArray(query.payload) ? query.payload : [query.payload];
                    const inserted = rows.map((row, index) => {
                        const nextRow = {
                            id: row.id || `discount-asset-${discountUserAssets.length + index + 1}`,
                            created_at: row.created_at || new Date().toISOString(),
                            ...row
                        };
                        discountUserAssets.push(nextRow);
                        return nextRow;
                    });

                    return {
                        data: query.single || query.maybeSingle ? (inserted[0] || null) : inserted,
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

                if (table === 'afdian_orders' && query.mode === 'select') {
                    let rows = applyCommonFilters(afdianOrders, query);
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

                if (table === 'afdian_orders' && query.mode === 'update') {
                    const matched = applyCommonFilters(afdianOrders, query);
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

                if (table === 'payment_events' && query.mode === 'delete') {
                    const matched = applyCommonFilters(paymentEvents, query);
                    matched.forEach((row) => {
                        const index = paymentEvents.indexOf(row);
                        if (index >= 0) {
                            paymentEvents.splice(index, 1);
                        }
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
                Host: 'verify-api.fatherkey.com'
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
        global.fetch = async (input, init) => {
            const url = String(input || '');
            if (url === 'https://verify.test/openapi') {
                const body = JSON.parse(init?.body || '{}');
                assert.equal(body.action, 'get_balance');
                assert.equal(body.cdkey, 'verify-api-key');
                return new Response(JSON.stringify({
                    remaining_uses: 11,
                    total_used: 4,
                    success: true
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
                    Host: 'verify-api.fatherkey.com'
                }
            });
            const payload = response.json();

            assert.equal(response.status, 200);
            assert.equal(payload.success, true);
            assert.equal(payload.balance, 11);
            assert.equal(payload.remaining_uses, 11);
            assert.equal(payload.remaining_extract_jobs, 22);
            assert.equal(payload.remaining_full_jobs, 11);
            assert.equal(payload.total_used, 4);
            assert.equal(payload.extract_cost_per_job, 0.5);
            assert.equal(payload.full_cost_per_job, 1);
            assert.match(payload.key_name, /^veri\.\.\..+/);
            assert.equal(Array.isArray(payload.key_states), true);
            assert.equal(payload.key_states[0].api_key, 'verify-api-key');
            assert.equal(payload.key_states[0].remaining_uses, 11);
        } finally {
            global.fetch = originalFetch;
        }
    });
});

test('quota endpoint allows requests signed with verify monitor internal key', async () => {
    await withEnv({ VERIFY_MONITOR_INTERNAL_KEY: 'verify-internal-secret' }, async () => {
        await withTestServer({}, async ({ app }) => {
            const originalFetch = global.fetch;
            global.fetch = async (input, init) => {
                const url = String(input || '');
                if (url === 'https://verify.test/openapi') {
                    const body = JSON.parse(init?.body || '{}');
                    assert.equal(body.action, 'get_balance');
                    assert.equal(body.cdkey, 'verify-api-key');
                    return new Response(JSON.stringify({
                        remaining_uses: 9,
                        total_used: 2,
                        success: true
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
                        [VERIFY_MONITOR_INTERNAL_HEADER_NAME]: 'verify-internal-secret'
                    }
                });
                const payload = response.json();

                assert.equal(response.status, 200);
                assert.equal(payload.success, true);
                assert.equal(payload.balance, 9);
                assert.equal(payload.remaining_uses, 9);
                assert.equal(payload.remaining_extract_jobs, 18);
                assert.equal(payload.remaining_full_jobs, 9);
                assert.match(payload.key_name, /^veri\.\.\..+/);
                assert.equal(Array.isArray(payload.key_states), true);
                assert.equal(payload.key_states[0].api_key, 'verify-api-key');
            } finally {
                global.fetch = originalFetch;
            }
        });
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
        },
        verificationLogs: [
            {
                id: 'queue-log-1',
                user_id: 'user-1',
                site: 'cn',
                verification_id: 'job-queue-1',
                status: 'queued',
                created_at: '2026-03-22T12:00:00.000Z',
                message: JSON.stringify({ kind: 'google_one_job', job_id: 'job-queue-1', email: 'queued@example.com' })
            },
            {
                id: 'queue-log-2',
                user_id: 'user-2',
                site: 'cn',
                verification_id: 'job-run-1',
                status: 'running',
                created_at: '2026-03-22T12:01:00.000Z',
                message: JSON.stringify({ kind: 'google_one_job', job_id: 'job-run-1', email: 'running@example.com' })
            },
            {
                id: 'queue-log-3',
                user_id: 'user-3',
                site: 'cn',
                verification_id: 'job-proc-1',
                status: 'processing',
                created_at: '2026-03-22T12:02:00.000Z',
                message: JSON.stringify({ kind: 'google_one_job', job_id: 'job-proc-1', email: 'processing@example.com' })
            }
        ]
    }, async ({ app }) => {
        const response = await dispatchRoute(app, {
            url: '/api/queue',
            headers: {
                Authorization: 'Bearer admin-token'
            }
        });
        const payload = response.json();

        assert.equal(response.status, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.queue_size, 1);
        assert.equal(payload.running_jobs, 2);
        assert.equal(payload.source, 'local_tracked_jobs');
    });
});

test('queue endpoint allows requests signed with verify monitor internal key', async () => {
    await withEnv({ VERIFY_MONITOR_INTERNAL_KEY: 'verify-internal-secret' }, async () => {
        await withTestServer({
            verificationLogs: [
                {
                    id: 'internal-queue-log-1',
                    user_id: 'user-1',
                    site: 'cn',
                    verification_id: 'job-queue-2',
                    status: 'pending',
                    created_at: '2026-03-22T12:00:00.000Z',
                    message: JSON.stringify({ kind: 'google_one_job', job_id: 'job-queue-2', email: 'pending@example.com' })
                },
                {
                    id: 'internal-queue-log-2',
                    user_id: 'user-2',
                    site: 'cn',
                    verification_id: 'job-run-2',
                    status: 'running',
                    created_at: '2026-03-22T12:01:00.000Z',
                    message: JSON.stringify({ kind: 'google_one_job', job_id: 'job-run-2', email: 'running@example.com' })
                }
            ]
        }, async ({ app }) => {
            const response = await dispatchRoute(app, {
                url: '/api/queue',
                headers: {
                    [VERIFY_MONITOR_INTERNAL_HEADER_NAME]: 'verify-internal-secret'
                }
            });
            const payload = response.json();

            assert.equal(response.status, 200);
            assert.equal(payload.success, true);
            assert.equal(payload.queue_size, 1);
            assert.equal(payload.running_jobs, 1);
        });
    });
});

test('network request-context endpoint does not accept verify monitor internal key', async () => {
    await withEnv({ VERIFY_MONITOR_INTERNAL_KEY: 'verify-internal-secret' }, async () => {
        await withTestServer({}, async ({ app }) => {
            const response = await dispatchRoute(app, {
                url: '/api/admin/network/request-context',
                headers: {
                    [VERIFY_MONITOR_INTERNAL_HEADER_NAME]: 'verify-internal-secret'
                },
                remoteAddress: '10.0.0.2'
            });
            const payload = response.json();

            assert.equal(response.status, 401);
            assert.equal(payload.code, 'unauthorized');
        });
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
                Host: 'verify-api.fatherkey.com',
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
                Host: 'verify-api.fatherkey.com',
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
            if (url === 'https://verify.test/openapi') {
                const body = JSON.parse(init?.body || '{}');
                if (body.action === 'get_status') {
                    assert.equal(body.task_id, 'job-queued-1');
                    return new Response(JSON.stringify({
                        success: true,
                        data: {
                            task_id: 'job-queued-1',
                            status: 'Success',
                            task_type: 'extract',
                            offer_url: 'https://example.com/precharged-result'
                        }
                    }), {
                        status: 200,
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    });
                }
                assert.equal(body.action, 'submit_task');
                assert.equal(body.cdkey, 'verify-api-key');
                assert.equal(body.email, 'member@example.com');
                assert.equal(body.twofa, 'totp-secret');
                assert.equal(body.task_type, 'extract');
                assert.equal(state.pointsLedger.length, 1, 'user points must be charged before calling upstream');
                assert.equal(state.pointsLedger[0].amount, -10);
                assert.match(state.pointsLedger[0].reference_id, /^verify:submit_task:/);
                return new Response(JSON.stringify({
                    success: true,
                    task_id: 'job-queued-1',
                    message: '任务提交成功'
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
            assert.equal(payload.task_type, 'extract');
            assert.equal(payload.pricePerVerify, 10);
            assert.equal(state.verificationLogs.length, 1);
            assert.equal(state.verificationLogs[0].user_id, 'user-1');
            assert.equal(state.verificationLogs[0].site, 'cn');
            assert.equal(state.verificationLogs[0].verification_id, 'job-queued-1');
            assert.equal(state.verificationLogs[0].points_deducted, 10);
            const trackedPayload = JSON.parse(state.verificationLogs[0].message || '{}');
            assert.equal(trackedPayload.billing.charges.submit_task.state, 'charged');

            const statusResponse = await dispatchRoute(app, {
                url: '/api/verify/status/job-queued-1',
                headers: {
                    Authorization: 'Bearer member-token'
                }
            });
            assert.equal(statusResponse.status, 200);
            assert.equal(statusResponse.json().success, true);
            assert.equal(state.metrics.deductCalls, 1, 'terminal success must not charge a precharged task again');
            assert.equal(state.pointsLedger.length, 1);
        } finally {
            global.fetch = originalFetch;
        }
    });
});

test('verify submit accepts full-flow mode and charges the configured full-flow price', async () => {
    const state = {
        tokens: {
            'member-token': { id: 'user-1', email: 'member@example.com' }
        },
        balances: {
            'user-1': 100
        },
        verifySettings: {
            price_per_verify: 10,
            price_per_verify_extract: 10,
            price_per_verify_full: 26,
            verify_api_key: 'verify-api-key',
            verify_api_base_url: 'https://verify.test'
        },
        verificationLogs: []
    };

    await withTestServer(state, async ({ app }) => {
        const originalFetch = global.fetch;
        global.fetch = async (input, init) => {
            const url = String(input || '');
            if (url === 'https://verify.test/openapi') {
                const body = JSON.parse(init?.body || '{}');
                assert.equal(body.action, 'submit_task');
                assert.equal(body.task_type, 'full');
                assert.equal(state.pointsLedger.length, 1, 'full-flow points must be charged before calling upstream');
                assert.equal(state.pointsLedger[0].amount, -26);
                return new Response(JSON.stringify({
                    success: true,
                    task_id: 'job-full-1',
                    message: '全流程任务已提交'
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
                    taskType: 'full'
                }
            });
            const payload = response.json();

            assert.equal(response.status, 200);
            assert.equal(payload.success, true);
            assert.equal(payload.job_id, 'job-full-1');
            assert.equal(payload.task_type, 'full');
            assert.equal(payload.pricePerVerify, 26);
        } finally {
            global.fetch = originalFetch;
        }
    });
});

test('verify submit refunds the precharge only after an explicit upstream rejection', async () => {
    const state = {
        tokens: {
            'member-token': { id: 'user-1', email: 'member@example.com' }
        },
        balances: {
            'user-1': 100
        },
        verificationLogs: [],
        pointsLedger: []
    };

    await withTestServer(state, async ({ app }) => {
        const originalFetch = global.fetch;
        global.fetch = async (input, init) => {
            assert.equal(String(input || ''), 'https://verify.test/openapi');
            const body = JSON.parse(init?.body || '{}');
            assert.equal(body.action, 'submit_task');
            assert.equal(state.pointsLedger.length, 1);
            assert.equal(state.pointsLedger[0].amount, -10);
            return new Response(JSON.stringify({
                success: false,
                code: 'invalid_account',
                message: '账号参数无效'
            }), {
                status: 400,
                headers: {
                    'Content-Type': 'application/json'
                }
            });
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
                    taskType: 'extract'
                }
            });
            const payload = response.json();

            assert.equal(response.status, 400);
            assert.equal(payload.success, false);
            assert.equal(payload.code, 'invalid_account');
            assert.equal(payload.pointsRefunded, 10);
            assert.equal(state.verificationLogs.length, 0);
            assert.equal(state.pointsLedger.length, 2);
            assert.equal(state.pointsLedger[1].amount, 10);
            assert.match(state.pointsLedger[1].reference_id, /^verify:submit_task:.*:refund$/);
        } finally {
            global.fetch = originalFetch;
        }
    });
});

test('verify submit retains the precharge when a server error leaves upstream billing uncertain', async () => {
    const state = {
        tokens: {
            'member-token': { id: 'user-1', email: 'member@example.com' }
        },
        balances: {
            'user-1': 100
        },
        verificationLogs: [],
        pointsLedger: []
    };

    await withTestServer(state, async ({ app }) => {
        const originalFetch = global.fetch;
        global.fetch = async () => new Response(JSON.stringify({
            success: false,
            message: 'upstream response failed after dispatch'
        }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json'
            }
        });

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
                    taskType: 'extract'
                }
            });
            const payload = response.json();

            assert.equal(response.status, 503);
            assert.equal(payload.success, false);
            assert.equal(payload.code, 'upstream_submit_outcome_unknown');
            assert.equal(payload.pointsDeducted, 10);
            assert.equal(payload.pointsRefunded, 0);
            assert.match(payload.billing_reference, /^verify:submit_task:/);
            assert.equal(state.pointsLedger.length, 1);
            assert.equal(state.pointsLedger[0].amount, -10);
            assert.equal(state.verificationLogs.length, 0);
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
                site: 'cn',
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
                site: 'cn',
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
                site: 'cn',
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

test('afdian webhook fails closed in production-like runtimes when the source IP allowlist is missing', async () => {
    const state = {
        paymentEvents: []
    };

    await withTestServer(state, async ({ app }) => {
        const response = await withEnv({
            DEPLOYMENT_TIER: 'production'
        }, async () => dispatchRoute(app, {
            method: 'POST',
            url: '/api/afdian/webhook',
            body: {
                ec: 200,
                sign: 'ignored',
                data: {
                    type: 'order',
                    order: {
                        out_trade_no: 'AFD-NO-ALLOWLIST',
                        status: 2,
                        total_amount: '5.00'
                    }
                }
            }
        }));
        const payload = response.json();

        assert.equal(response.status, 503);
        assert.deepEqual(payload, { ec: 503, em: 'webhook source allowlist not configured' });
        assert.equal(state.paymentEvents.length, 0);
    });
});

test('afdian webhook resolves site from the linked pending checkout session when the request origin is not site-specific', async () => {
    const nowIso = new Date().toISOString();
    const state = {
        paymentEvents: [],
        paymentCheckoutSessions: [
            {
                id: 'checkout-afd-intl-1',
                user_id: 'user-intl-1',
                provider: 'afdian',
                site: 'intl',
                package_id: 'pkg-intl-1',
                package_name: 'Intl Package',
                expected_amount: 20,
                requested_points: 200,
                granted_points: 200,
                status: 'redirect_ready',
                payment_order_id: null,
                created_at: nowIso,
                provider_metadata: {}
            }
        ],
        paymentOrders: [
            {
                id: 'pay-order-afd-intl-pending',
                provider: 'afdian',
                provider_order_no: 'PENDING_AFDIAN_INTL_CHECKOUT_1',
                checkout_session_id: 'checkout-afd-intl-1',
                site: 'intl',
                status: 'pending',
                provider_metadata: {
                    provider_order_pending: true,
                    provider_order_resolved: false
                },
                created_at: nowIso
            }
        ],
        pointsPackages: [
            {
                id: 'pkg-intl-1',
                name: 'Intl Package',
                points_amount: 200,
                bonus_points: 0,
                price_cny: 20,
                sku_id: 'sku-intl-20',
                is_active: true
            }
        ],
        afdianProcessPaymentResult: {
            status: 'paid',
            payment_order_id: 'pay-order-afd-intl-pending'
        }
    };

    await withTestServer(state, async ({ app }) => {
        const payloadData = {
            type: 'order',
            order: {
                out_trade_no: 'AFD-REAL-INTL-1',
                status: 2,
                plan_id: 'sku-intl-20',
                total_amount: '20.00',
                user_id: 'afd-user-1'
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
            headers: {
                host: 'verify-api.fatherkey.com'
            },
            body: {
                ec: 200,
                sign,
                data: payloadData
            }
        }));
        const payload = response.json();
        const processCall = state.rpcCalls.find((call) => call.name === 'fn_process_afdian_payment');

        assert.equal(response.status, 200);
        assert.deepEqual(payload, { ec: 200, em: '' });
        assert.ok(processCall);
        assert.equal(processCall.args.p_site, 'intl');
    });
});

test('afdian webhook fails closed when it cannot resolve a trusted payment site', async () => {
    const state = {
        paymentEvents: [],
        pointsPackages: [
            {
                id: 'pkg-unresolved-1',
                name: 'Unresolved Package',
                points_amount: 200,
                bonus_points: 0,
                price_cny: 20,
                sku_id: 'sku-unresolved-20',
                is_active: true
            }
        ]
    };

    await withTestServer(state, async ({ app }) => {
        const payloadData = {
            type: 'order',
            order: {
                out_trade_no: 'AFD-SITE-UNRESOLVED',
                status: 2,
                plan_id: 'sku-unresolved-20',
                total_amount: '20.00',
                user_id: 'afd-user-2'
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
            headers: {
                host: 'zaoyoe.com'
            },
            body: {
                ec: 200,
                sign,
                data: payloadData
            }
        }));
        const payload = response.json();
        const processCall = state.rpcCalls.find((call) => call.name === 'fn_process_afdian_payment');

        assert.equal(response.status, 503);
        assert.deepEqual(payload, { ec: 503, em: 'payment site unresolved' });
        assert.equal(state.paymentEvents.length, 0);
        assert.equal(processCall, undefined);
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

test('hupijiao webhook issues linked discount assets after a successful recharge', async () => {
    const state = {
        discountTriggerRules: {
            recharge: {
                enabled: true,
                rules: [
                    {
                        discount_id: 'discount-hj-1',
                        min_paid_amount: 9.9
                    }
                ]
            }
        },
        discountCodes: [
            {
                id: 'discount-hj-1',
                code: 'HJ-RECHARGE',
                applicable_site: 'cn',
                distribution_mode: 'user_assigned',
                expires_at: '2026-12-31T23:59:59.000Z',
                is_active: true,
                starts_at: '2026-01-01T00:00:00.000Z',
                lifecycle_status: 'active',
                status_reason: null,
                max_uses: null,
                used_count: 0
            }
        ],
        discountUserAssets: [],
        paymentEvents: [],
        paymentOrders: [
            {
                id: 'pay-order-hj-discount-1',
                provider: 'hupijiao',
                provider_order_no: 'HJ_ORDER_DISCOUNT_1',
                checkout_session_id: 'checkout-hj-discount-1',
                user_id: 'user-discount-1',
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
                id: 'checkout-hj-discount-1',
                session_key: 'PCS_HUPIJIAO_TEST_DISCOUNT_1',
                provider: 'hupijiao',
                user_id: 'user-discount-1',
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
                    provider_order_no: 'HJ_ORDER_DISCOUNT_1'
                },
                created_at: '2026-03-23T00:00:00.000Z'
            }
        ]
    };

    await withTestServer(state, async ({ app }) => {
        const payload = {
            trade_order_id: 'HJ_ORDER_DISCOUNT_1',
            total_fee: '9.90',
            transaction_id: 'TXN_HJ_DISCOUNT_1',
            open_order_id: 'OPEN_HJ_DISCOUNT_1',
            order_title: '虎皮椒套餐',
            status: 'OD',
            appid: 'appid-123',
            time: '1742711999',
            nonce_str: 'nonce_hj_discount_1',
            attach: JSON.stringify({
                provider: 'hupijiao',
                user_id: 'user-discount-1',
                site: 'cn',
                checkout_session_id: 'checkout-hj-discount-1',
                checkout_session_key: 'PCS_HUPIJIAO_TEST_DISCOUNT_1',
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

        assert.equal(response.status, 200);
        assert.equal(response.text, 'success');
        assert.equal(state.discountUserAssets.length, 1);
        assert.equal(state.discountUserAssets[0].discount_id, 'discount-hj-1');
        assert.equal(state.discountUserAssets[0].user_id, 'user-discount-1');
        assert.equal(state.discountUserAssets[0].source_type, 'recharge_linkage');
        assert.equal(state.discountUserAssets[0].source_channel, 'wallet_recharge');
    });
});

test('hupijiao webhook fails closed in production-like runtimes when the source IP allowlist is missing', async () => {
    const state = {
        paymentEvents: []
    };

    await withTestServer(state, async ({ app }) => {
        const response = await withEnv({
            DEPLOYMENT_TIER: 'production'
        }, async () => dispatchRoute(app, {
            method: 'POST',
            url: '/api/payments/hupijiao/webhook',
            body: {
                trade_order_id: 'HJ-NO-ALLOWLIST',
                transaction_id: 'txn-hj-no-allowlist',
                status: 'SUCCESS',
                total_fee: '5.00'
            }
        }));

        assert.equal(response.status, 503);
        assert.equal(response.text, 'webhook source allowlist not configured');
        assert.equal(state.paymentEvents.length, 0);
    });
});

test('afdian query does not return redeem codes for unowned orders even when a code already exists', async () => {
    const nowIso = new Date().toISOString();
    const state = {
        tokens: {
            'member-token': { id: 'user-1', email: 'member@example.com' }
        },
        paymentOrders: [
            {
                id: 'payment-order-final',
                provider: 'afdian',
                provider_order_no: 'AFD-CODE-LEAK-1',
                checkout_session_id: null,
                user_id: null,
                site: 'intl',
                package_id: 'pkg-intl-1',
                package_name: 'Intl Package',
                expected_amount: 20,
                paid_amount: 20,
                points_amount: 200,
                status: 'paid',
                sign_verified: true,
                amount_verified: true,
                provider_metadata: {},
                created_at: nowIso,
                paid_at: nowIso
            }
        ],
        afdianOrders: [
            {
                id: 'afdian-order-1',
                out_trade_no: 'AFD-CODE-LEAK-1',
                total_amount: 20,
                points: 200,
                redeem_code: 'SECRET-CODE-LEAK',
                is_redeemed: false,
                created_at: nowIso,
                payment_status: 'paid',
                sign_verified: true,
                amount_verified: true,
                site: 'intl',
                site_user_id: null,
                claimed_at: null,
                payment_order_id: 'payment-order-final',
                plan_id: 'sku-intl-20',
                raw_payload: {},
                paid_at: nowIso
            }
        ]
    };

    await withTestServer(state, async ({ app }) => {
        const response = await dispatchRoute(app, {
            method: 'POST',
            url: '/api/afdian/query',
            headers: {
                Authorization: 'Bearer member-token',
                Host: 'www.fatherkey.com',
                Origin: 'https://www.fatherkey.com'
            },
            body: {
                order_no: 'AFD-CODE-LEAK-1'
            }
        });
        const payload = response.json();

        assert.equal(response.status, 200);
        assert.equal(payload.success, false);
        assert.equal(payload.status, 'paid');
        assert.match(payload.message, /尚未安全匹配到当前账号的支付意图/);
        assert.equal(payload.code, undefined);
        assert.deepEqual(payload.consumed_payment_claim_ids, []);
        assert.equal(state.afdianOrders[0].site_user_id, null);
    });
});

test('afdian query can safely claim an unowned order with a valid payment claim token', async () => {
    const now = Date.now();
    const sourceCreatedAt = new Date(now - 60 * 1000).toISOString();
    const nowIso = new Date(now).toISOString();
    const claimEnv = {
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
        PAYMENT_CUSTOM_RECHARGE_QUOTE_SECRET: 'quote-secret'
    };
    const claim = issuePaymentIntentClaimToken({
        userId: 'user-1',
        site: 'intl',
        providerKey: 'afdian',
        checkoutSessionId: 'checkout-afd-intl-claim',
        packageId: 'pkg-intl-1',
        packageName: 'Intl Package',
        expectedAmount: 20,
        pointsAmount: 200,
        chargeType: 'package',
        env: claimEnv
    });

    const state = {
        tokens: {
            'member-token': { id: 'user-1', email: 'member@example.com' }
        },
        paymentCheckoutSessions: [
            {
                id: 'checkout-afd-intl-claim',
                user_id: 'user-1',
                provider: 'afdian',
                site: 'intl',
                package_id: 'pkg-intl-1',
                package_name: 'Intl Package',
                expected_amount: 20,
                requested_points: 200,
                granted_points: 200,
                status: 'redirect_ready',
                payment_order_id: null,
                created_at: sourceCreatedAt,
                provider_metadata: {}
            }
        ],
        paymentOrders: [
            {
                id: 'payment-order-pending',
                provider: 'afdian',
                provider_order_no: 'PENDING_AFDIAN_INTL_CLAIM_1',
                checkout_session_id: 'checkout-afd-intl-claim',
                user_id: 'user-1',
                site: 'intl',
                package_id: 'pkg-intl-1',
                package_name: 'Intl Package',
                expected_amount: 20,
                points_amount: 200,
                status: 'pending',
                provider_metadata: {
                    provider_order_pending: true,
                    provider_order_resolved: false
                },
                created_at: sourceCreatedAt
            },
            {
                id: 'payment-order-final',
                provider: 'afdian',
                provider_order_no: 'AFD-CLAIM-1',
                checkout_session_id: null,
                user_id: null,
                site: 'intl',
                package_id: 'pkg-intl-1',
                package_name: 'Intl Package',
                expected_amount: 20,
                paid_amount: 20,
                points_amount: 200,
                status: 'paid',
                sign_verified: true,
                amount_verified: true,
                provider_metadata: {},
                created_at: nowIso,
                paid_at: nowIso
            }
        ],
        afdianOrders: [
            {
                id: 'afdian-order-1',
                out_trade_no: 'AFD-CLAIM-1',
                total_amount: 20,
                points: 200,
                redeem_code: 'SAFE-CLAIM-CODE',
                is_redeemed: false,
                created_at: nowIso,
                payment_status: 'paid',
                sign_verified: true,
                amount_verified: true,
                site: 'intl',
                site_user_id: null,
                claimed_at: null,
                payment_order_id: 'payment-order-final',
                plan_id: 'sku-intl-20',
                raw_payload: {},
                paid_at: nowIso
            }
        ]
    };

    await withEnv(claimEnv, async () => {
        await withTestServer(state, async ({ app }) => {
            const response = await dispatchRoute(app, {
                method: 'POST',
                url: '/api/afdian/query',
                headers: {
                    Authorization: 'Bearer member-token',
                    Host: 'www.fatherkey.com',
                    Origin: 'https://www.fatherkey.com'
                },
                body: {
                    order_no: 'AFD-CLAIM-1',
                    claim_tokens: [claim.token]
                }
            });
            const payload = response.json();
            const finalPaymentOrder = state.paymentOrders.find((item) => item.id === 'payment-order-final');
            const sourcePaymentOrder = state.paymentOrders.find((item) => item.id === 'payment-order-pending');

            assert.equal(response.status, 200);
            assert.equal(payload.success, true);
            assert.equal(payload.code, 'SAFE-CLAIM-CODE');
            assert.deepEqual(payload.consumed_payment_claim_ids, [claim.intentId]);
            assert.equal(finalPaymentOrder.user_id, 'user-1');
            assert.equal(finalPaymentOrder.checkout_session_id, 'checkout-afd-intl-claim');
            assert.equal(finalPaymentOrder.provider_metadata.claim_token_intent_id, claim.intentId);
            assert.equal(sourcePaymentOrder.checkout_session_id, null);
            assert.equal(state.afdianOrders[0].site_user_id, 'user-1');
            assert.equal(state.afdianOrders[0].payment_order_id, 'payment-order-final');
        });
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
                    task_type: 'extract',
                    raw_status: 'queued'
                })
            }
        ],
        pointsLedger: []
    };

    await withTestServer(state, async ({ app }) => {
        const originalFetch = global.fetch;
        global.fetch = async (input, init) => {
            const url = String(input || '');
            if (url === 'https://verify.test/openapi') {
                const body = JSON.parse(init?.body || '{}');
                assert.equal(body.action, 'get_status');
                assert.equal(body.task_id, 'job-success-1');
                return new Response(JSON.stringify({
                    success: true,
                    task_id: 'job-success-1',
                    status: 'Success',
                    task_type: 'extract',
                    stage: 3,
                    total_stages: 3,
                    stage_label: 'done',
                    offer_url: 'https://example.com/result',
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

test('verify legacy success with an unpaid settlement withholds the upstream result', async () => {
    const state = {
        tokens: {
            'member-token': { id: 'user-1', email: 'member@example.com' }
        },
        balances: {
            'user-1': 0
        },
        deductedAmountOverride: 0,
        verificationLogs: [
            {
                id: 'verify-job-unpaid-legacy-1',
                user_id: 'user-1',
                site: 'cn',
                verification_id: 'job-unpaid-legacy-1',
                status: 'queued',
                points_deducted: 0,
                created_at: '2026-03-22T12:00:00.000Z',
                message: JSON.stringify({
                    kind: 'google_one_job',
                    job_id: 'job-unpaid-legacy-1',
                    email: 'member@example.com',
                    task_type: 'extract',
                    raw_status: 'queued'
                })
            }
        ],
        pointsLedger: []
    };

    await withTestServer(state, async ({ app }) => {
        const originalFetch = global.fetch;
        global.fetch = async (input, init) => {
            assert.equal(String(input || ''), 'https://verify.test/openapi');
            const body = JSON.parse(init?.body || '{}');
            assert.equal(body.action, 'get_status');
            return new Response(JSON.stringify({
                success: true,
                data: {
                    task_id: 'job-unpaid-legacy-1',
                    status: 'Success',
                    task_type: 'extract',
                    offer_url: 'https://example.com/must-not-leak'
                }
            }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json'
                }
            });
        };

        try {
            const response = await dispatchRoute(app, {
                url: '/api/verify/status/job-unpaid-legacy-1',
                headers: {
                    Authorization: 'Bearer member-token'
                }
            });
            const payload = response.json();
            const trackedPayload = JSON.parse(state.verificationLogs[0].message || '{}');

            assert.equal(response.status, 402);
            assert.equal(payload.success, false);
            assert.equal(payload.code, 'verify_billing_pending');
            assert.equal(payload.status, 'billing_pending');
            assert.equal(payload.url, '');
            assert.equal(state.metrics.deductCalls, 1);
            assert.equal(state.pointsLedger.length, 0);
            assert.equal(state.verificationLogs[0].status, 'billing_pending');
            assert.equal(trackedPayload.url, '');
            assert.equal(trackedPayload.offer_url, '');
            assert.equal(trackedPayload.has_offer_url, false);
        } finally {
            global.fetch = originalFetch;
        }
    });
});

test('verify failed polling refunds a prior precharge after upstream confirms failure', async () => {
    const chargeReference = 'verify:submit_task:failed-job-charge';
    const state = {
        tokens: {
            'member-token': { id: 'user-1', email: 'member@example.com' }
        },
        balances: {
            'user-1': 90
        },
        verificationLogs: [
            {
                id: 'verify-job-precharged-failed-1',
                user_id: 'user-1',
                site: 'cn',
                verification_id: 'job-precharged-failed-1',
                status: 'queued',
                points_deducted: 10,
                created_at: '2026-03-22T12:00:00.000Z',
                message: JSON.stringify({
                    kind: 'google_one_job',
                    job_id: 'job-precharged-failed-1',
                    email: 'member@example.com',
                    task_type: 'extract',
                    raw_status: 'queued',
                    billing: {
                        version: 2,
                        charges: {
                            submit_task: {
                                action: 'submit_task',
                                state: 'charged',
                                reference_id: chargeReference,
                                refund_reference_id: `${chargeReference}:refund`,
                                charged_points: 10,
                                charged_paid: 10,
                                charged_bonus: 0
                            }
                        }
                    }
                })
            }
        ],
        pointsLedger: [
            {
                id: 'ledger-precharge-1',
                user_id: 'user-1',
                amount: -10,
                reference_id: chargeReference,
                site: 'cn',
                created_at: '2026-03-22T12:00:00.000Z'
            }
        ]
    };

    await withTestServer(state, async ({ app }) => {
        const originalFetch = global.fetch;
        global.fetch = async (input, init) => {
            assert.equal(String(input || ''), 'https://verify.test/openapi');
            const body = JSON.parse(init?.body || '{}');
            assert.equal(body.action, 'get_status');
            assert.equal(body.task_id, 'job-precharged-failed-1');
            return new Response(JSON.stringify({
                success: true,
                data: {
                    task_id: 'job-precharged-failed-1',
                    status: 'Failed',
                    message: '执行失败，卡片无效',
                    task_type: 'extract',
                    has_offer_url: false
                }
            }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json'
                }
            });
        };

        try {
            const response = await dispatchRoute(app, {
                url: '/api/verify/status/job-precharged-failed-1',
                headers: {
                    Authorization: 'Bearer member-token'
                }
            });
            const payload = response.json();
            const trackedPayload = JSON.parse(state.verificationLogs[0].message || '{}');

            assert.equal(response.status, 200);
            assert.equal(payload.status, 'failed');
            assert.equal(payload.pointsDeducted, 0);
            assert.equal(payload.pointsRefunded, 10);
            assert.equal(state.metrics.deductCalls, 0);
            assert.equal(state.pointsLedger.length, 2);
            assert.equal(state.pointsLedger[1].amount, 10);
            assert.equal(state.pointsLedger[1].reference_id, `${chargeReference}:refund`);
            assert.equal(state.verificationLogs[0].points_deducted, 0);
            assert.equal(trackedPayload.billing.charges.submit_task.state, 'refunded');
        } finally {
            global.fetch = originalFetch;
        }
    });
});

test('verify status polling can repair a previously misclassified failed job once upstream reports success', async () => {
    const state = {
        tokens: {
            'member-token': { id: 'user-1', email: 'member@example.com' }
        },
        balances: {
            'user-1': 100
        },
        verificationLogs: [
            {
                id: 'verify-job-repair-1',
                user_id: 'user-1',
                site: 'cn',
                verification_id: 'job-repair-1',
                status: 'failed',
                points_deducted: 0,
                created_at: '2026-03-22T12:00:00.000Z',
                message: JSON.stringify({
                    kind: 'google_one_job',
                    job_id: 'job-repair-1',
                    email: 'member@example.com',
                    task_type: 'extract',
                    error_code: 'job_not_found',
                    error_message: '任务不存在',
                    raw_status: 'failed'
                })
            }
        ],
        pointsLedger: []
    };

    await withTestServer(state, async ({ app }) => {
        const originalFetch = global.fetch;
        global.fetch = async (input, init) => {
            const url = String(input || '');
            if (url === 'https://verify.test/openapi') {
                const body = JSON.parse(init?.body || '{}');
                assert.equal(body.action, 'get_status');
                assert.equal(body.task_id, 'job-repair-1');
                return new Response(JSON.stringify({
                    success: true,
                    task_id: 'job-repair-1',
                    status: 'Success',
                    task_type: 'extract',
                    offer_url: 'https://example.com/repaired',
                    elapsed_seconds: 21
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
                url: '/api/verify/status/job-repair-1',
                headers: {
                    Authorization: 'Bearer member-token'
                }
            });
            const payload = response.json();

            assert.equal(response.status, 200);
            assert.equal(payload.success, true);
            assert.equal(payload.status, 'success');
            assert.equal(payload.url, 'https://example.com/repaired');
            assert.equal(payload.pointsDeducted, 10);
            assert.equal(state.verificationLogs[0].status, 'success');
            assert.equal(state.verificationLogs[0].points_deducted, 10);
        } finally {
            global.fetch = originalFetch;
        }
    });
});

test('verify action endpoint cancels pending aidone tasks and refunds the prior precharge', async () => {
    const chargeReference = 'verify:submit_task:cancel-job-charge';
    const state = {
        tokens: {
            'member-token': { id: 'user-1', email: 'member@example.com' }
        },
        balances: {
            'user-1': 100
        },
        verificationLogs: [
            {
                id: 'verify-job-cancel-1',
                user_id: 'user-1',
                site: 'cn',
                verification_id: 'job-cancel-1',
                status: 'queued',
                points_deducted: 20,
                created_at: '2026-03-22T12:00:00.000Z',
                message: JSON.stringify({
                    kind: 'google_one_job',
                    job_id: 'job-cancel-1',
                    email: 'member@example.com',
                    task_type: 'full',
                    provider: 'aidone',
                    raw_status: 'queued',
                    billing: {
                        version: 2,
                        charges: {
                            submit_task: {
                                action: 'submit_task',
                                state: 'charged',
                                reference_id: chargeReference,
                                refund_reference_id: `${chargeReference}:refund`,
                                charged_points: 20,
                                charged_paid: 20,
                                charged_bonus: 0
                            }
                        }
                    }
                })
            }
        ],
        pointsLedger: [
            {
                id: 'ledger-cancel-precharge-1',
                user_id: 'user-1',
                amount: -20,
                reference_id: chargeReference,
                site: 'cn',
                created_at: '2026-03-22T12:00:00.000Z'
            }
        ]
    };

    await withTestServer(state, async ({ app }) => {
        const originalFetch = global.fetch;
        global.fetch = async (input, init) => {
            const url = String(input || '');
            if (url === 'https://verify.test/openapi') {
                const body = JSON.parse(init?.body || '{}');
                assert.equal(body.action, 'cancel_task');
                assert.equal(body.cdkey, 'verify-api-key');
                assert.equal(body.task_id, 'job-cancel-1');
                return new Response(JSON.stringify({
                    success: true,
                    message: '任务已成功取消并退还卡密余额'
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
                url: '/api/verify/action',
                headers: {
                    Authorization: 'Bearer member-token'
                },
                body: {
                    action: 'cancel_task',
                    taskId: 'job-cancel-1'
                }
            });
            const payload = response.json();

            assert.equal(response.status, 200);
            assert.equal(payload.success, true);
            assert.equal(payload.action, 'cancel_task');
            assert.equal(payload.status, 'failed');
            assert.equal(payload.pointsDeducted, 0);
            assert.equal(payload.pointsRefunded, 20);
            assert.equal(state.metrics.deductCalls, 0);
            assert.equal(state.pointsLedger.length, 2);
            assert.equal(state.pointsLedger[1].amount, 20);
            assert.equal(state.pointsLedger[1].reference_id, `${chargeReference}:refund`);
            assert.equal(state.verificationLogs[0].status, 'failed');
            assert.equal(state.verificationLogs[0].points_deducted, 0);
        } finally {
            global.fetch = originalFetch;
        }
    });
});

test('verify action endpoint purchases a failed captured link at extract price', async () => {
    const state = {
        tokens: {
            'member-token': { id: 'user-1', email: 'member@example.com' }
        },
        balances: {
            'user-1': 100
        },
        verifySettings: {
            price_per_verify: 10,
            price_per_verify_extract: 10,
            price_per_verify_full: 24,
            verify_api_key: 'verify-api-key',
            verify_api_base_url: 'https://verify.test'
        },
        verificationLogs: [
            {
                id: 'verify-job-failed-link-1',
                user_id: 'user-1',
                site: 'cn',
                verification_id: 'job-failed-link-1',
                status: 'failed',
                points_deducted: 0,
                created_at: '2026-03-22T12:00:00.000Z',
                message: JSON.stringify({
                    kind: 'google_one_job',
                    job_id: 'job-failed-link-1',
                    email: 'member@example.com',
                    task_type: 'full',
                    provider: 'aidone',
                    has_offer_url: true,
                    raw_status: 'failed'
                })
            }
        ],
        pointsLedger: []
    };

    await withTestServer(state, async ({ app }) => {
        const originalFetch = global.fetch;
        global.fetch = async (input, init) => {
            const url = String(input || '');
            if (url === 'https://verify.test/openapi') {
                const body = JSON.parse(init?.body || '{}');
                assert.equal(body.action, 'purchase_failed_link');
                assert.equal(body.cdkey, 'verify-api-key');
                assert.equal(body.task_id, 'job-failed-link-1');
                return new Response(JSON.stringify({
                    success: true,
                    message: '提取链接购买成功！扣除额度: 0.5',
                    offer_url: 'https://example.com/failed-link',
                    remaining_uses: 448.5
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
                url: '/api/verify/action',
                headers: {
                    Authorization: 'Bearer member-token'
                },
                body: {
                    action: 'purchase_failed_link',
                    taskId: 'job-failed-link-1'
                }
            });
            const payload = response.json();
            const updatedPayload = JSON.parse(state.verificationLogs[0].message || '{}');

            assert.equal(response.status, 200);
            assert.equal(payload.success, true);
            assert.equal(payload.action, 'purchase_failed_link');
            assert.equal(payload.status, 'success');
            assert.equal(payload.task_type, 'extract');
            assert.equal(payload.url, 'https://example.com/failed-link');
            assert.equal(payload.remaining_uses, 448.5);
            assert.equal(payload.pointsDeducted, 10);
            assert.equal(state.metrics.deductCalls, 1);
            assert.equal(state.pointsLedger.length, 1);
            assert.match(state.pointsLedger[0].reference_id, /^verify:purchase_failed_link:/);
            assert.equal(state.pointsLedger[0].amount, -10);
            assert.equal(state.verificationLogs[0].status, 'success');
            assert.equal(state.verificationLogs[0].points_deducted, 10);
            assert.equal(updatedPayload.task_type, 'extract');
            assert.equal(updatedPayload.url, 'https://example.com/failed-link');
        } finally {
            global.fetch = originalFetch;
        }
    });
});

test('verify full-flow success polling deducts the configured full-flow price once per job id', async () => {
    const state = {
        tokens: {
            'member-token': { id: 'user-1', email: 'member@example.com' }
        },
        balances: {
            'user-1': 100
        },
        verifySettings: {
            price_per_verify: 10,
            price_per_verify_extract: 10,
            price_per_verify_full: 24,
            verify_api_key: 'verify-api-key',
            verify_api_base_url: 'https://verify.test'
        },
        verificationLogs: [
            {
                id: 'verify-job-full-1',
                user_id: 'user-1',
                site: 'cn',
                verification_id: 'job-full-1',
                status: 'queued',
                points_deducted: 0,
                created_at: '2026-03-22T12:00:00.000Z',
                message: JSON.stringify({
                    kind: 'google_one_job',
                    job_id: 'job-full-1',
                    email: 'member@example.com',
                    task_type: 'full',
                    raw_status: 'queued'
                })
            }
        ],
        pointsLedger: []
    };

    await withTestServer(state, async ({ app }) => {
        const originalFetch = global.fetch;
        global.fetch = async (input, init) => {
            const url = String(input || '');
            if (url === 'https://verify.test/openapi') {
                const body = JSON.parse(init?.body || '{}');
                assert.equal(body.action, 'get_status');
                assert.equal(body.task_id, 'job-full-1');
                return new Response(JSON.stringify({
                    success: true,
                    task_id: 'job-full-1',
                    status: 'Completed',
                    task_type: 'full',
                    message: '包绑卡流程完成',
                    elapsed_seconds: 42
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
                url: '/api/verify/status/job-full-1',
                headers: {
                    Authorization: 'Bearer member-token'
                }
            });
            const payload = response.json();

            assert.equal(response.status, 200);
            assert.equal(payload.success, true);
            assert.equal(payload.task_type, 'full');
            assert.equal(payload.pointsDeducted, 24);
            assert.equal(state.metrics.deductCalls, 1);
            assert.equal(state.pointsLedger.length, 1);
            assert.equal(state.verificationLogs[0].points_deducted, 24);
        } finally {
            global.fetch = originalFetch;
        }
    });
});
