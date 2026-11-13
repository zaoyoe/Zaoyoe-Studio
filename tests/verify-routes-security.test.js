const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const Module = require('node:module');
const {
    VERIFY_MONITOR_INTERNAL_HEADER_NAME
} = require('../api/_lib/verify-monitor-internal-access');

const {
    issuePaymentIntentClaimToken
} = require('../api/_lib/payments/orders');
const {
    issueAdminStudioToken
} = require('../api/_lib/admin-studio-access.mjs');

const TEST_MEMBER_ID = '33333333-3333-4333-8333-333333333333';
const TEST_ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const TEST_SESSION_ID = '22222222-2222-4222-8222-222222222222';
const TEST_STUDIO_GRANT_ID = '44444444-4444-4444-8444-444444444444';

function buildTestBearerJwt(userId, sessionId = TEST_SESSION_ID) {
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
        sub: userId,
        session_id: sessionId,
        exp: Math.floor(Date.now() / 1000) + 3600
    })}.test-signature`;
}

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
            },
            admin: {
                async getUserById(userId) {
                    const user = state.usersById?.[userId]
                        || Object.values(tokens).find((entry) => entry?.id === userId)
                        || null;
                    if (user) {
                        return { data: { user }, error: null };
                    }
                    return { data: { user: null }, error: { message: 'User not found' } };
                }
            }
        },
        rpc(name, args = {}) {
            rpcCalls.push({ name, args });
            if (name === 'admin_auth_session_active') {
                return createRpcResult(
                    state.activeBearerSession === undefined ? true : state.activeBearerSession,
                    state.activeBearerSessionError || null
                );
            }

            if (name === 'admin_studio_session_active') {
                return createRpcResult(
                    state.activeStudioSession === undefined ? true : state.activeStudioSession,
                    state.activeStudioSessionError || null
                );
            }

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
    const memberJwt = buildTestBearerJwt(TEST_MEMBER_ID);
    await withTestServer({
        tokens: {
            [memberJwt]: { id: TEST_MEMBER_ID, email: 'member@example.com' }
        }
    }, async ({ app }) => {
        const response = await dispatchRoute(app, {
            url: '/api/quota',
            headers: {
                Authorization: `Bearer ${memberJwt}`,
                Host: 'verify-api.fatherkey.com'
            }
        });
        const payload = response.json();

        assert.equal(response.status, 403);
        assert.equal(payload.code, 'admin_required');
    });
});

test('quota endpoint allows admins and proxies upstream data', async () => {
    const adminJwt = buildTestBearerJwt(TEST_ADMIN_ID);
    await withTestServer({
        tokens: {
            [adminJwt]: { id: TEST_ADMIN_ID, email: 'admin@example.com' }
        },
        permissions: {
            [TEST_ADMIN_ID]: { is_admin: true, is_super_admin: false, permissions: ['settings.manage'] }
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
                    Authorization: `Bearer ${adminJwt}`,
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
            assert.equal(payload.key_states[0].api_key, undefined);
            assert.match(payload.key_states[0].masked_key, /^veri\.\.\..+/);
            assert.match(payload.key_states[0].key_fingerprint, /^sha256:[0-9a-f]{24}$/);
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
                assert.equal(payload.key_states[0].api_key, undefined);
                assert.match(payload.key_states[0].masked_key, /^veri\.\.\..+/);
                assert.match(payload.key_states[0].key_fingerprint, /^sha256:[0-9a-f]{24}$/);
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
    const memberJwt = buildTestBearerJwt(TEST_MEMBER_ID);
    await withTestServer({
        tokens: {
            [memberJwt]: { id: TEST_MEMBER_ID, email: 'member@example.com' }
        }
    }, async ({ app }) => {
        const response = await dispatchRoute(app, {
            url: '/api/queue',
            headers: {
                Authorization: `Bearer ${memberJwt}`
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
    const adminJwt = buildTestBearerJwt(TEST_ADMIN_ID);
    await withTestServer({
        tokens: {
            [adminJwt]: { id: TEST_ADMIN_ID, email: 'admin@example.com' }
        },
        permissions: {
            [TEST_ADMIN_ID]: { is_admin: true, is_super_admin: false, permissions: ['settings.manage'] }
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
                Authorization: `Bearer ${adminJwt}`
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
    const memberJwt = buildTestBearerJwt(TEST_MEMBER_ID);
    await withTestServer({
        tokens: {
            [memberJwt]: { id: TEST_MEMBER_ID, email: 'member@example.com' }
        }
    }, async ({ app }) => {
        const response = await dispatchRoute(app, {
            url: '/api/admin/network/request-context',
            headers: {
                Authorization: `Bearer ${memberJwt}`
            },
            remoteAddress: '10.0.0.2'
        });
        const payload = response.json();

        assert.equal(response.status, 403);
        assert.equal(payload.code, 'admin_required');
    });
});

test('network request-context endpoint returns proxy diagnostics for admins', async () => {
    const adminJwt = buildTestBearerJwt(TEST_ADMIN_ID);
    await withTestServer({
        tokens: {
            [adminJwt]: { id: TEST_ADMIN_ID, email: 'admin@example.com' }
        },
        permissions: {
            [TEST_ADMIN_ID]: { is_admin: true, is_super_admin: false, permissions: ['settings.manage'] }
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
                Authorization: `Bearer ${adminJwt}`,
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
    const adminJwt = buildTestBearerJwt(TEST_ADMIN_ID);
    await withTestServer({
        tokens: {
            [adminJwt]: { id: TEST_ADMIN_ID, email: 'admin@example.com' }
        },
        permissions: {
            [TEST_ADMIN_ID]: { is_admin: true, is_super_admin: false, permissions: ['settings.manage'] }
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
                Authorization: `Bearer ${adminJwt}`,
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

test('verify admin endpoints reject revoked bearer sessions and missing RBAC permissions', async () => {
    const adminJwt = buildTestBearerJwt(TEST_ADMIN_ID);

    await withTestServer({
        activeBearerSession: false,
        tokens: {
            [adminJwt]: { id: TEST_ADMIN_ID, email: 'admin@example.com' }
        },
        permissions: {
            [TEST_ADMIN_ID]: { is_admin: true, is_super_admin: false, permissions: ['settings.manage'] }
        }
    }, async ({ app }) => {
        const response = await dispatchRoute(app, {
            url: '/api/quota',
            headers: {
                Authorization: `Bearer ${adminJwt}`,
                Host: 'verify-api.fatherkey.com'
            }
        });
        assert.equal(response.status, 401);
    });

    await withTestServer({
        tokens: {
            [adminJwt]: { id: TEST_ADMIN_ID, email: 'admin@example.com' }
        },
        permissions: {
            [TEST_ADMIN_ID]: { is_admin: true, is_super_admin: false, permissions: ['analytics.view'] }
        }
    }, async ({ app }) => {
        for (const url of ['/api/quota', '/api/queue', '/api/admin/network/request-context']) {
            const response = await dispatchRoute(app, {
                url,
                headers: {
                    Authorization: `Bearer ${adminJwt}`,
                    Host: 'verify-api.fatherkey.com'
                },
                remoteAddress: '10.0.0.2'
            });
            const payload = response.json();
            assert.equal(response.status, 403);
            assert.equal(payload.code, 'admin_permission_required');
        }
    });
});

test('verify admin endpoints honor active zaoyoe_admin_studio cookies and reject revoked studio grants', async () => {
    await withEnv({ ADMIN_STUDIO_ACCESS_SECRET: 'verify-route-studio-secret' }, async () => {
        const studioCookieToken = await issueAdminStudioToken({
            sub: TEST_ADMIN_ID,
            sid: TEST_STUDIO_GRANT_ID
        });

        await withTestServer({
            activeStudioSession: true,
            usersById: {
                [TEST_ADMIN_ID]: { id: TEST_ADMIN_ID, email: 'admin@example.com' }
            },
            permissions: {
                [TEST_ADMIN_ID]: { is_admin: true, is_super_admin: false, permissions: ['settings.manage'] }
            }
        }, async ({ app }) => {
            const response = await dispatchRoute(app, {
                url: '/api/queue',
                headers: {
                    Cookie: `zaoyoe_admin_studio=${studioCookieToken}`,
                    Host: 'verify-api.fatherkey.com'
                }
            });
            const payload = response.json();
            assert.equal(response.status, 200);
            assert.equal(payload.success, true);
        });

        await withTestServer({
            activeStudioSession: false,
            usersById: {
                [TEST_ADMIN_ID]: { id: TEST_ADMIN_ID, email: 'admin@example.com' }
            },
            permissions: {
                [TEST_ADMIN_ID]: { is_admin: true, is_super_admin: false, permissions: ['settings.manage'] }
            }
        }, async ({ app }) => {
            const response = await dispatchRoute(app, {
                url: '/api/queue',
                headers: {
                    Cookie: `zaoyoe_admin_studio=${studioCookieToken}`,
                    Host: 'verify-api.fatherkey.com'
                }
            });
            assert.equal(response.status, 401);
        });
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

test('retired payment endpoints return 410 Gone', async () => {
    const state = {};

    await withTestServer(state, async ({ app }) => {
        const afdianWebhook = await dispatchRoute(app, {
            method: 'POST',
            url: '/api/afdian/webhook',
            body: {}
        });
        assert.equal(afdianWebhook.status, 410);

        const afdianQuery = await dispatchRoute(app, {
            method: 'GET',
            url: '/api/afdian/query?order_no=test'
        });
        assert.equal(afdianQuery.status, 410);

        const hupijiaoWebhook = await dispatchRoute(app, {
            method: 'POST',
            url: '/api/payments/hupijiao/webhook',
            body: {}
        });
        assert.equal(hupijiaoWebhook.status, 410);
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
