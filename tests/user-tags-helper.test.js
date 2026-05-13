const test = require('node:test');
const assert = require('node:assert/strict');

const {
    AUTO_USER_TAGS,
    DEFAULT_USER_TAG_AUTOMATION,
    getUserCommerceMetrics,
    getUserLastActivityAt,
    listKnownUserTagDefinitions,
    loadUserTagAutomationConfig,
    markPaymentFailed,
    markUserActive,
    markUserAsPaid,
    markUsersAsPaid,
    markVerifyFailed,
    normalizeTagValue,
    normalizeUserTagAutomationConfig,
    sweepInactiveUserTags,
    syncInactiveUserTagForUser,
    syncPaymentStatusUserTags
} = require('../api/_lib/user-tags');

function createUserTagSupabaseStub(options = {}) {
    const state = {
        rows: Array.isArray(options.rows) ? options.rows.slice() : [],
        config: options.config,
        paymentOrders: Array.isArray(options.paymentOrders) ? options.paymentOrders.slice() : [],
        shopOrders: Array.isArray(options.shopOrders) ? options.shopOrders.slice() : [],
        verificationLogs: Array.isArray(options.verificationLogs) ? options.verificationLogs.slice() : [],
        checkoutSessions: Array.isArray(options.checkoutSessions) ? options.checkoutSessions.slice() : [],
        activityRows: Array.isArray(options.activityRows) ? options.activityRows.slice() : [],
        engagementEvents: Array.isArray(options.engagementEvents) ? options.engagementEvents.slice() : [],
        loginHistory: Array.isArray(options.loginHistory) ? options.loginHistory.slice() : [],
        operations: []
    };

    function getTableRows(table) {
        if (table === 'system_config') {
            if (typeof state.config === 'undefined') return [];
            return [{
                config_key: 'engagement_user_tag_center',
                config_value: state.config
            }];
        }
        if (table === 'payment_orders') return state.paymentOrders;
        if (table === 'shop_orders') return state.shopOrders;
        if (table === 'verification_logs') return state.verificationLogs;
        if (table === 'payment_checkout_sessions') return state.checkoutSessions;
        if (table === 'engagement_user_activity') return state.activityRows;
        if (table === 'engagement_events') return state.engagementEvents;
        if (table === 'user_login_history') return state.loginHistory;
        if (table === 'user_tags') return state.rows;
        throw new Error(`unexpected table access: ${table}`);
    }

    function filterRows(table, filters, limitCount) {
        let rows = getTableRows(table).filter((row) => filters.every((filter) => {
            if (filter.type === 'eq') {
                return row[filter.column] === filter.value;
            }
            if (filter.type === 'in') {
                return Array.isArray(filter.values) && filter.values.includes(row[filter.column]);
            }
            if (filter.type === 'gte') {
                return String(row[filter.column] || '') >= String(filter.value || '');
            }
            if (filter.type === 'lte') {
                return String(row[filter.column] || '') <= String(filter.value || '');
            }
            return true;
        }));
        if (Number.isFinite(limitCount)) {
            rows = rows.slice(0, limitCount);
        }
        return rows;
    }

    function createSelectBuilder(table) {
        const filters = [];
        let limitCount = null;
        let rangeFrom = null;
        let rangeTo = null;
        const selectRows = () => {
            let rows = filterRows(table, filters, limitCount);
            if (Number.isFinite(rangeFrom) && Number.isFinite(rangeTo)) {
                rows = rows.slice(rangeFrom, rangeTo + 1);
            }
            return rows;
        };
        const builder = {
            select() {
                return builder;
            },
            order() {
                return builder;
            },
            eq(column, value) {
                filters.push({ type: 'eq', column, value });
                return builder;
            },
            in(column, values) {
                filters.push({ type: 'in', column, values });
                return builder;
            },
            gte(column, value) {
                filters.push({ type: 'gte', column, value });
                return builder;
            },
            lte(column, value) {
                filters.push({ type: 'lte', column, value });
                return builder;
            },
            limit(value) {
                limitCount = Number(value);
                return builder;
            },
            range(from, to) {
                rangeFrom = Number(from);
                rangeTo = Number(to);
                return builder;
            },
            maybeSingle() {
                const rows = selectRows();
                return Promise.resolve({ data: rows[0] || null, error: null });
            },
            then(resolve, reject) {
                return Promise.resolve({ data: selectRows(), error: null }).then(resolve, reject);
            }
        };
        return builder;
    }

    return {
        state,
        from(table) {
            const builder = {
                select() {
                    return createSelectBuilder(table);
                },
                upsert(payload, opts = {}) {
                    state.operations.push({ type: 'upsert', payload, opts });
                    const rows = Array.isArray(payload) ? payload : [payload];
                    if (table === 'engagement_user_activity') {
                        rows.forEach((row) => {
                            const existing = state.activityRows.find((item) => (
                                item.user_id === row.user_id
                                && String(item.site || 'cn') === String(row.site || 'cn')
                            ));
                            if (existing) {
                                Object.assign(existing, row);
                            } else {
                                state.activityRows.push({ ...row });
                            }
                        });
                        return Promise.resolve({ data: rows, error: null });
                    }
                    assert.equal(table, 'user_tags');
                    rows.forEach((row) => {
                        const existing = state.rows.find((item) => item.user_id === row.user_id && item.tag === row.tag);
                        if (existing) {
                            Object.assign(existing, row);
                        } else {
                            state.rows.push({ ...row });
                        }
                    });
                    return Promise.resolve({ data: rows, error: null });
                },
                delete() {
                    assert.equal(table, 'user_tags');
                    const deleteState = {
                        userId: '',
                        tags: []
                    };
                    const deleteBuilder = {
                        eq(column, value) {
                            if (column === 'user_id') {
                                deleteState.userId = value;
                            }
                            return deleteBuilder;
                        },
                        in(column, values) {
                            if (column === 'tag') {
                                deleteState.tags = Array.isArray(values) ? values : [];
                            }
                            state.operations.push({ type: 'delete', ...deleteState });
                            state.rows = state.rows.filter((row) => (
                                row.user_id !== deleteState.userId || !deleteState.tags.includes(row.tag)
                            ));
                            return Promise.resolve({ data: null, error: null });
                        }
                    };
                    return deleteBuilder;
                }
            };
            return builder;
        }
    };
}

test('known user tag definitions merge user-management tags into engagement segments', async () => {
    const supabase = createUserTagSupabaseStub({
        rows: [
            { user_id: 'user-1', tag: 'payment_failed' },
            { user_id: 'user-2', tag: '用户' },
            { user_id: 'user-3', tag: '关注' },
            { user_id: 'user-4', tag: '测试' },
            { user_id: 'user-5', tag: 'custom_tag' },
            { user_id: 'user-6', tag: 'creator' }
        ]
    });

    const definitions = await listKnownUserTagDefinitions(supabase);
    const byKey = new Map(definitions.map((definition) => [definition.key, definition]));

    assert.equal(byKey.get('用户')?.name, '用户');
    assert.equal(byKey.get('关注')?.name, '关注');
    assert.equal(byKey.get('测试')?.name, '测试');
    assert.equal(byKey.get('creator')?.name, '创作者');
    assert.equal(byKey.get('payment_failed')?.name, '支付失败用户');
    assert.equal(byKey.get('custom_tag')?.name, 'custom_tag');
});

test('user tag helper normalizes and upserts commercial engagement tags', async () => {
    const supabase = createUserTagSupabaseStub();

    const result = await markPaymentFailed(supabase, {
        userId: 'user-1'
    });

    assert.equal(result.ok, true);
    assert.deepEqual(supabase.state.rows, [
        { user_id: 'user-1', tag: AUTO_USER_TAGS.PAYMENT_FAILED }
    ]);
    assert.equal(normalizeTagValue(' Payment Failed! '), 'payment_failed');
});

test('paid tag removes stale payment failure tag for a user', async () => {
    const supabase = createUserTagSupabaseStub({
        rows: [
            { user_id: 'user-1', tag: AUTO_USER_TAGS.PAYMENT_FAILED }
        ]
    });

    await markUserAsPaid(supabase, {
        userId: 'user-1'
    });

    assert.deepEqual(supabase.state.rows, [
        { user_id: 'user-1', tag: AUTO_USER_TAGS.PAID_USER }
    ]);
});

test('bulk paid tags support commerce success sweep rows', async () => {
    const supabase = createUserTagSupabaseStub({
        rows: [
            { user_id: 'user-2', tag: AUTO_USER_TAGS.PAYMENT_FAILED }
        ]
    });

    await markUsersAsPaid(supabase, {
        userIds: ['user-1', 'user-2', 'user-1']
    });

    assert.deepEqual(
        supabase.state.rows.sort((left, right) => left.user_id.localeCompare(right.user_id)),
        [
            { user_id: 'user-1', tag: AUTO_USER_TAGS.PAID_USER },
            { user_id: 'user-2', tag: AUTO_USER_TAGS.PAID_USER }
        ]
    );
});

test('payment and verify terminal statuses map to engagement tags', async () => {
    const supabase = createUserTagSupabaseStub();

    await syncPaymentStatusUserTags(supabase, {
        userId: 'user-1',
        status: 'failed'
    });
    await markVerifyFailed(supabase, {
        userId: 'user-1'
    });

    assert.deepEqual(
        supabase.state.rows.map((row) => row.tag).sort(),
        [AUTO_USER_TAGS.PAYMENT_FAILED, AUTO_USER_TAGS.VERIFY_FAILED].sort()
    );
});

test('user tag automation config normalizes commercial thresholds', async () => {
    const supabase = createUserTagSupabaseStub({
        config: {
            automation: {
                high_value: {
                    enabled: 'true',
                    minPaidAmount: '88.5',
                    minPoints: '9000',
                    minOrderCount: '3'
                },
                payment_failed: {
                    enabled: 'false',
                    windowDays: '14',
                    minCount: '2'
                }
            }
        }
    });

    const config = await loadUserTagAutomationConfig(supabase);

    assert.equal(config.high_value.enabled, true);
    assert.equal(config.high_value.min_paid_amount, 88.5);
    assert.equal(config.high_value.min_points, 9000);
    assert.equal(config.high_value.min_order_count, 3);
    assert.equal(config.payment_failed.enabled, false);
    assert.equal(config.payment_failed.window_days, 14);
    assert.equal(config.payment_failed.min_count, 2);
    assert.equal(config.verify_failed.window_days, DEFAULT_USER_TAG_AUTOMATION.verify_failed.window_days);
    assert.equal(normalizeUserTagAutomationConfig({ inactive: { inactiveDays: '60' } }).inactive.inactive_days, 60);
});

test('user tag automation resolves thresholds and commerce metrics by site', async () => {
    const supabase = createUserTagSupabaseStub({
        config: {
            __site_scoped: true,
            default: {
                automation: {
                    high_value: {
                        enabled: true,
                        min_paid_amount: 999,
                        min_points: 999999,
                        min_order_count: 99
                    }
                }
            },
            sites: {
                intl: {
                    automation: {
                        high_value: {
                            enabled: true,
                            min_paid_amount: 10,
                            min_points: 999999,
                            min_order_count: 99
                        }
                    }
                }
            }
        },
        paymentOrders: [
            { user_id: 'user-1', site: 'cn', status: 'paid', paid_amount: 20, points_amount: 0 },
            { user_id: 'user-1', site: 'intl', status: 'paid', paid_amount: 20, points_amount: 0 }
        ]
    });

    const cnConfig = await loadUserTagAutomationConfig(supabase, { site: 'cn' });
    const intlConfig = await loadUserTagAutomationConfig(supabase, { site: 'intl' });
    assert.equal(cnConfig.high_value.min_paid_amount, 999);
    assert.equal(intlConfig.high_value.min_paid_amount, 10);

    await markUserAsPaid(supabase, {
        userId: 'user-1',
        site: 'intl'
    });

    assert.deepEqual(
        supabase.state.rows.map((row) => row.tag).sort(),
        [AUTO_USER_TAGS.HIGH_VALUE, AUTO_USER_TAGS.PAID_USER].sort()
    );
});

test('paid users are promoted to high value only after configured commerce threshold', async () => {
    const supabase = createUserTagSupabaseStub({
        config: {
            automation: {
                high_value: {
                    enabled: true,
                    min_paid_amount: 100,
                    min_points: 100000,
                    min_order_count: 99
                }
            }
        },
        paymentOrders: [
            {
                id: 'payment-1',
                user_id: 'user-1',
                status: 'paid',
                paid_amount: 120,
                points_amount: 1200
            }
        ]
    });

    const metrics = await getUserCommerceMetrics(supabase, 'user-1');
    await markUserAsPaid(supabase, {
        userId: 'user-1'
    });

    assert.equal(metrics.paidAmount, 120);
    assert.equal(metrics.orderCount, 1);
    assert.deepEqual(
        supabase.state.rows.map((row) => row.tag).sort(),
        [AUTO_USER_TAGS.HIGH_VALUE, AUTO_USER_TAGS.PAID_USER].sort()
    );
});

test('payment failure automation waits for the configured failure count', async () => {
    const now = new Date().toISOString();
    const supabase = createUserTagSupabaseStub({
        config: {
            automation: {
                payment_failed: {
                    enabled: true,
                    window_days: 7,
                    min_count: 3
                }
            }
        },
        paymentOrders: [
            { id: 'payment-1', user_id: 'user-1', status: 'failed', created_at: now },
            { id: 'payment-2', user_id: 'user-1', status: 'expired', created_at: now }
        ]
    });

    const skipped = await markPaymentFailed(supabase, {
        userId: 'user-1'
    });
    supabase.state.paymentOrders.push({ id: 'payment-3', user_id: 'user-1', status: 'failed', created_at: now });
    const tagged = await markPaymentFailed(supabase, {
        userId: 'user-1'
    });

    assert.equal(skipped.ok, false);
    assert.equal(skipped.skipped, 'payment_failed_threshold_not_met');
    assert.equal(tagged.ok, true);
    assert.deepEqual(supabase.state.rows, [
        { user_id: 'user-1', tag: AUTO_USER_TAGS.PAYMENT_FAILED }
    ]);
});

test('verify failure automation waits for the configured failure count', async () => {
    const now = new Date().toISOString();
    const supabase = createUserTagSupabaseStub({
        config: {
            automation: {
                verify_failed: {
                    enabled: true,
                    window_days: 7,
                    min_count: 2
                }
            }
        },
        verificationLogs: [
            { id: 'verify-1', user_id: 'user-1', status: 'failed', created_at: now }
        ]
    });

    const skipped = await markVerifyFailed(supabase, {
        userId: 'user-1'
    });
    supabase.state.verificationLogs.push({ id: 'verify-2', user_id: 'user-1', status: 'failed', created_at: now });
    const tagged = await markVerifyFailed(supabase, {
        userId: 'user-1'
    });

    assert.equal(skipped.ok, false);
    assert.equal(skipped.skipped, 'verify_failed_threshold_not_met');
    assert.equal(tagged.ok, true);
    assert.deepEqual(supabase.state.rows, [
        { user_id: 'user-1', tag: AUTO_USER_TAGS.VERIFY_FAILED }
    ]);
});

test('inactive automation tags stale users before removing the tag on fresh activity', async () => {
    const oldActiveAt = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const supabase = createUserTagSupabaseStub({
        config: {
            automation: {
                inactive: {
                    enabled: true,
                    inactive_days: 30
                }
            }
        },
        activityRows: [
            { user_id: 'user-1', last_active_at: oldActiveAt, last_page_id: 'home', site: 'cn' }
        ]
    });

    const lastActiveAt = await getUserLastActivityAt(supabase, 'user-1');
    const tagged = await syncInactiveUserTagForUser(supabase, {
        userId: 'user-1'
    });
    const active = await markUserActive(supabase, {
        userId: 'user-1',
        pageId: 'shop',
        site: 'cn'
    });

    assert.equal(lastActiveAt, oldActiveAt);
    assert.equal(tagged.ok, true);
    assert.equal(active.ok, true);
    assert.equal(supabase.state.rows.length, 0);
    assert.equal(supabase.state.activityRows[0].last_page_id, 'shop');
});

test('inactive sweep tags users whose heartbeat is older than threshold', async () => {
    const oldActiveAt = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
    const freshActiveAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const supabase = createUserTagSupabaseStub({
        config: {
            automation: {
                inactive: {
                    enabled: true,
                    inactive_days: 30
                }
            }
        },
        activityRows: [
            { user_id: 'user-old', last_active_at: oldActiveAt, last_page_id: 'home', site: 'cn' },
            { user_id: 'user-fresh', last_active_at: freshActiveAt, last_page_id: 'shop', site: 'cn' }
        ]
    });

    const result = await sweepInactiveUserTags(supabase, {
        limit: 10
    });

    assert.equal(result.ok, true);
    assert.equal(result.tagged, 1);
    assert.deepEqual(supabase.state.rows, [
        { user_id: 'user-old', tag: AUTO_USER_TAGS.INACTIVE_USER }
    ]);
});
