const test = require('node:test');
const assert = require('node:assert/strict');

const {
    DISCOUNT_TRIGGER_CONFIG_KEY,
    maybeIssueAffiliateDiscountAssetsForRecharge,
    maybeIssueAffiliateDiscountAssetsForShopOrder,
    maybeIssueCheckinDiscountAssets,
    maybeIssueRechargeDiscountAssets
} = require('../api/_lib/discount-trigger-linkage');

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createQueryBuilder(executor) {
    const state = {
        mode: 'select',
        payload: null,
        filters: [],
        single: false,
        maybeSingle: false
    };

    const builder = {
        insert(payload) {
            state.mode = 'insert';
            state.payload = payload;
            return builder;
        },
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
        single() {
            state.single = true;
            return builder;
        },
        maybeSingle() {
            state.maybeSingle = true;
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

function applyFilters(rows, query) {
    return rows.filter((row) => query.filters.every((filter) => {
        if (filter.op === 'eq') {
            return row?.[filter.column] === filter.value;
        }

        if (filter.op === 'in') {
            return Array.isArray(filter.value) && filter.value.includes(row?.[filter.column]);
        }

        return false;
    }));
}

function createSupabaseDouble(state) {
    state.systemConfigRows = clone(state.systemConfigRows || []);
    state.paymentOrders = clone(state.paymentOrders || []);
    state.discountCodes = clone(state.discountCodes || []);
    state.discountUserAssets = clone(state.discountUserAssets || []);
    state.pointsLedger = clone(state.pointsLedger || []);

    return {
        from(table) {
            return createQueryBuilder(async (query) => {
                if (table === 'system_config' && query.mode === 'select') {
                    const rows = applyFilters(state.systemConfigRows, query);
                    return {
                        data: query.single || query.maybeSingle ? (rows[0] || null) : rows,
                        error: null
                    };
                }

                if (table === 'payment_orders' && query.mode === 'select') {
                    const rows = applyFilters(state.paymentOrders, query);
                    return {
                        data: query.single || query.maybeSingle ? (rows[0] || null) : rows,
                        error: null
                    };
                }

                if (table === 'discount_codes' && query.mode === 'select') {
                    const rows = applyFilters(state.discountCodes, query);
                    return {
                        data: query.single || query.maybeSingle ? (rows[0] || null) : rows,
                        error: null
                    };
                }

                if (table === 'discount_user_assets' && query.mode === 'select') {
                    const rows = applyFilters(state.discountUserAssets, query);
                    return {
                        data: query.single || query.maybeSingle ? (rows[0] || null) : rows,
                        error: null
                    };
                }

                if (table === 'discount_user_assets' && query.mode === 'insert') {
                    const rows = Array.isArray(query.payload) ? query.payload : [query.payload];
                    const inserted = rows.map((row, index) => {
                        const nextRow = {
                            id: row.id || `asset-${state.discountUserAssets.length + index + 1}`,
                            ...clone(row)
                        };
                        state.discountUserAssets.push(nextRow);
                        return nextRow;
                    });
                    return {
                        data: inserted,
                        error: null
                    };
                }

                if (table === 'points_ledger' && query.mode === 'select') {
                    const rows = applyFilters(state.pointsLedger, query);
                    return {
                        data: query.single || query.maybeSingle ? (rows[0] || null) : rows,
                        error: null
                    };
                }

                throw new Error(`Unexpected table access in test: ${table}/${query.mode}`);
            });
        }
    };
}

function createActiveDiscount(id, overrides = {}) {
    return {
        id,
        code: `CODE-${id}`,
        applicable_site: 'cn',
        distribution_mode: 'user_assigned',
        expires_at: '2026-12-31T23:59:59.000Z',
        is_active: true,
        starts_at: '2026-01-01T00:00:00.000Z',
        lifecycle_status: 'active',
        status_reason: null,
        max_uses: null,
        used_count: 0,
        ...overrides
    };
}

function createRechargeConfig(rules = []) {
    return {
        config_key: DISCOUNT_TRIGGER_CONFIG_KEY,
        config_value: {
            recharge: {
                enabled: true,
                rules
            }
        }
    };
}

function createCheckinConfig(rules = []) {
    return {
        config_key: DISCOUNT_TRIGGER_CONFIG_KEY,
        config_value: {
            checkin: {
                enabled: true,
                rules
            }
        }
    };
}

function createAffiliateConfig(rules = []) {
    return {
        config_key: DISCOUNT_TRIGGER_CONFIG_KEY,
        config_value: {
            affiliate: {
                enabled: true,
                rules
            }
        }
    };
}

test('recharge linkage returns a no-op summary when config is missing', async () => {
    const supabase = createSupabaseDouble({});

    const result = await maybeIssueRechargeDiscountAssets({
        supabase,
        userId: 'user-1',
        site: 'cn',
        paidPoints: 100,
        bonusPoints: 10,
        paidAmount: 9.9,
        paymentOrderId: 'po-1',
        paymentProvider: 'mock',
        paymentOrderNo: 'MOCK_1'
    });

    assert.equal(result.success, true);
    assert.equal(result.matched_rule_count, 0);
    assert.equal(result.issued_count, 0);
    assert.deepEqual(result.assigned_discount_ids, []);
});

test('recharge linkage issues a user-assigned coupon when the rule matches', async () => {
    const state = {
        systemConfigRows: [
            createRechargeConfig([
                {
                    discount_id: 'discount-1',
                    min_paid_amount: 9.9,
                    source_channel: 'wallet_recharge'
                }
            ])
        ],
        discountCodes: [
            createActiveDiscount('discount-1')
        ]
    };
    const supabase = createSupabaseDouble(state);

    const result = await maybeIssueRechargeDiscountAssets({
        supabase,
        userId: 'user-1',
        site: 'cn',
        paidPoints: 100,
        bonusPoints: 10,
        paidAmount: 9.9,
        paymentOrderId: 'po-issue-1',
        paymentProvider: 'mock',
        paymentOrderNo: 'MOCK_ISSUE_1'
    });

    assert.equal(result.success, true);
    assert.equal(result.is_first_recharge, true);
    assert.equal(result.matched_rule_count, 1);
    assert.equal(result.issued_count, 1);
    assert.deepEqual(result.assigned_discount_ids, ['discount-1']);
    assert.equal(state.discountUserAssets.length, 1);
    assert.equal(state.discountUserAssets[0].discount_id, 'discount-1');
    assert.equal(state.discountUserAssets[0].user_id, 'user-1');
    assert.equal(state.discountUserAssets[0].source_type, 'recharge_linkage');
});

test('recharge linkage resolves site-scoped trigger rules before matching', async () => {
    const state = {
        systemConfigRows: [
            {
                config_key: DISCOUNT_TRIGGER_CONFIG_KEY,
                config_value: {
                    __site_scoped: true,
                    default: {
                        recharge: {
                            enabled: true,
                            rules: [
                                {
                                    discount_id: 'discount-cn',
                                    min_paid_amount: 9.9
                                }
                            ]
                        }
                    },
                    sites: {
                        intl: {
                            recharge: {
                                enabled: true,
                                rules: [
                                    {
                                        discount_id: 'discount-intl',
                                        min_paid_amount: 9.9
                                    }
                                ]
                            }
                        }
                    }
                }
            }
        ],
        discountCodes: [
            createActiveDiscount('discount-cn'),
            createActiveDiscount('discount-intl', { applicable_site: 'intl' })
        ]
    };
    const supabase = createSupabaseDouble(state);

    const result = await maybeIssueRechargeDiscountAssets({
        supabase,
        userId: 'user-intl',
        site: 'intl',
        paidPoints: 100,
        bonusPoints: 0,
        paidAmount: 9.9,
        paymentOrderId: 'po-intl-1',
        paymentProvider: 'mock'
    });

    assert.equal(result.success, true);
    assert.equal(result.issued_count, 1);
    assert.deepEqual(result.assigned_discount_ids, ['discount-intl']);
    assert.equal(state.discountUserAssets[0].discount_id, 'discount-intl');
});

test('recharge linkage respects first-recharge-only rules', async () => {
    const state = {
        systemConfigRows: [
            createRechargeConfig([
                {
                    discount_id: 'discount-first',
                    first_recharge_only: true
                }
            ])
        ],
        paymentOrders: [
            {
                id: 'po-history-1',
                user_id: 'user-1',
                site: 'cn',
                status: 'redeemed'
            }
        ],
        discountCodes: [
            createActiveDiscount('discount-first')
        ]
    };
    const supabase = createSupabaseDouble(state);

    const result = await maybeIssueRechargeDiscountAssets({
        supabase,
        userId: 'user-1',
        site: 'cn',
        paidPoints: 50,
        bonusPoints: 0,
        paidAmount: 5,
        paymentOrderId: 'po-next-1',
        paymentProvider: 'mock',
        paymentOrderNo: 'MOCK_NEXT_1'
    });

    assert.equal(result.success, true);
    assert.equal(result.is_first_recharge, false);
    assert.equal(result.matched_rule_count, 0);
    assert.equal(result.issued_count, 0);
    assert.equal(state.discountUserAssets.length, 0);
});

test('recharge linkage is idempotent for the same payment order source batch', async () => {
    const state = {
        systemConfigRows: [
            createRechargeConfig([
                {
                    discount_id: 'discount-repeat',
                    allow_duplicate_available_asset: true,
                    max_grants_per_user: 5
                }
            ])
        ],
        discountCodes: [
            createActiveDiscount('discount-repeat')
        ]
    };
    const supabase = createSupabaseDouble(state);
    const context = {
        supabase,
        userId: 'user-1',
        site: 'cn',
        paidPoints: 88,
        bonusPoints: 12,
        paidAmount: 8.8,
        paymentOrderId: 'po-repeat-1',
        paymentProvider: 'hupijiao',
        paymentOrderNo: 'HJ_REPEAT_1'
    };

    const firstResult = await maybeIssueRechargeDiscountAssets(context);
    const secondResult = await maybeIssueRechargeDiscountAssets(context);

    assert.equal(firstResult.issued_count, 1);
    assert.equal(secondResult.issued_count, 0);
    assert.equal(state.discountUserAssets.length, 1);
    assert.equal(secondResult.skipped[0]?.reason, '当前充值已发放过卡券');
});

test('checkin linkage issues a coupon when streak and reward thresholds match', async () => {
    const state = {
        systemConfigRows: [
            createCheckinConfig([
                {
                    discount_id: 'discount-checkin',
                    min_streak_days: 7,
                    min_points_reward: 5,
                    source_channel: 'checkin_reward'
                }
            ])
        ],
        discountCodes: [
            createActiveDiscount('discount-checkin')
        ]
    };
    const supabase = createSupabaseDouble(state);

    const result = await maybeIssueCheckinDiscountAssets({
        supabase,
        userId: 'user-checkin-1',
        site: 'cn',
        checkinDate: '2026-04-15',
        pointsReward: 55,
        baseReward: 5,
        bonusReward: 50,
        streakDays: 7
    });

    assert.equal(result.success, true);
    assert.equal(result.event_type, 'checkin');
    assert.equal(result.issued_count, 1);
    assert.deepEqual(result.assigned_discount_ids, ['discount-checkin']);
    assert.equal(state.discountUserAssets[0].source_type, 'checkin_linkage');
    assert.equal(state.discountUserAssets[0].source_channel, 'checkin_reward');
});

test('affiliate linkage issues coupons for shop commission and activation rewards', async () => {
    const state = {
        systemConfigRows: [
            createAffiliateConfig([
                {
                    discount_id: 'discount-commission',
                    reward_type: 'commission',
                    min_reward_points: 5,
                    source_channel: 'affiliate_commission'
                },
                {
                    discount_id: 'discount-activation',
                    reward_type: 'activation_reward',
                    min_reward_points: 10,
                    source_channel: 'affiliate_reward'
                }
            ])
        ],
        discountCodes: [
            createActiveDiscount('discount-commission'),
            createActiveDiscount('discount-activation')
        ],
        pointsLedger: [
            {
                id: 'ledger-aff-1',
                user_id: 'inviter-1',
                amount: 12,
                reason: '推广返佣 (10%): 下线购买商品',
                reference_id: 'AFFILIATE_REWARD_order-1',
                site: 'cn'
            },
            {
                id: 'ledger-aff-2',
                user_id: 'inviter-1',
                amount: 20,
                reason: '拉新固定奖励 (下线首单激活)',
                reference_id: 'REG_REWARD_UNLOCK_order-1',
                site: 'cn'
            }
        ]
    };
    const supabase = createSupabaseDouble(state);

    const result = await maybeIssueAffiliateDiscountAssetsForShopOrder({
        supabase,
        site: 'cn',
        orderId: 'order-1'
    });

    assert.equal(result.success, true);
    assert.equal(result.event_type, 'affiliate');
    assert.equal(result.reward_event_count, 2);
    assert.equal(result.issued_count, 2);
    assert.deepEqual(result.assigned_discount_ids.sort(), ['discount-activation', 'discount-commission']);
    assert.deepEqual(result.reward_types.sort(), ['activation_reward', 'commission']);
    assert.equal(state.discountUserAssets.every((row) => row.user_id === 'inviter-1'), true);
    assert.equal(state.discountUserAssets.every((row) => row.source_type === 'affiliate_linkage'), true);
});

test('affiliate linkage can issue activation coupon after a recharge reward row is created', async () => {
    const state = {
        systemConfigRows: [
            createAffiliateConfig([
                {
                    discount_id: 'discount-aff-recharge',
                    reward_type: 'activation_reward',
                    min_reward_points: 10,
                    source_channel: 'affiliate_reward'
                }
            ])
        ],
        discountCodes: [
            createActiveDiscount('discount-aff-recharge')
        ],
        pointsLedger: [
            {
                id: 'ledger-recharge-1',
                user_id: 'invitee-1',
                amount: 100,
                reason: '模拟充值: 标准充值',
                reference_id: 'mock_MOCK_PAY_1',
                site: 'cn'
            },
            {
                id: 'ledger-aff-recharge-1',
                user_id: 'inviter-2',
                amount: 30,
                reason: '拉新固定奖励 (下线首充激活)',
                reference_id: 'REG_REWARD_UNLOCK_RECHARGE_ledger-recharge-1',
                site: 'cn'
            }
        ]
    };
    const supabase = createSupabaseDouble(state);

    const result = await maybeIssueAffiliateDiscountAssetsForRecharge({
        supabase,
        site: 'cn',
        rechargeReferenceId: 'mock_MOCK_PAY_1'
    });

    assert.equal(result.success, true);
    assert.equal(result.reward_event_count, 1);
    assert.equal(result.issued_count, 1);
    assert.deepEqual(result.assigned_discount_ids, ['discount-aff-recharge']);
    assert.equal(state.discountUserAssets[0].user_id, 'inviter-2');
    assert.equal(state.discountUserAssets[0].source_batch_id, 'discount-trigger-affiliate:REG_REWARD_UNLOCK_RECHARGE_ledger-recharge-1');
});
