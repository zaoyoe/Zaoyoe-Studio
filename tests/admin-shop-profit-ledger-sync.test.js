const test = require('node:test');
const assert = require('node:assert/strict');

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createSupabaseStub(initialTables = {}) {
    const state = {
        calls: [],
        tables: clone(initialTables)
    };

    function createQueryBuilder(table) {
        const queryState = {
            eqFilters: [],
            inFilters: [],
            orderBy: null,
            ascending: false
        };

        function applyQuery() {
            let rows = Array.isArray(state.tables[table]) ? state.tables[table].map((row) => ({ ...row })) : [];

            for (const [column, value] of queryState.eqFilters) {
                rows = rows.filter((row) => String(row?.[column] || '') === String(value || ''));
            }

            for (const [column, values] of queryState.inFilters) {
                const safeValues = new Set(values.map((value) => String(value || '')));
                rows = rows.filter((row) => safeValues.has(String(row?.[column] || '')));
            }

            if (queryState.orderBy) {
                rows.sort((left, right) => {
                    const leftValue = String(left?.[queryState.orderBy] || '');
                    const rightValue = String(right?.[queryState.orderBy] || '');
                    return queryState.ascending
                        ? leftValue.localeCompare(rightValue)
                        : rightValue.localeCompare(leftValue);
                });
            }

            return rows;
        }

        const builder = {
            select(columns = '*') {
                state.calls.push({ table, mode: 'select', columns });
                return builder;
            },
            eq(column, value) {
                queryState.eqFilters.push([String(column || ''), value]);
                return builder;
            },
            in(column, values) {
                queryState.inFilters.push([String(column || ''), Array.isArray(values) ? values : []]);
                return builder;
            },
            order(column, options = {}) {
                queryState.orderBy = String(column || '');
                queryState.ascending = options?.ascending === true;
                return builder;
            },
            maybeSingle() {
                return Promise.resolve({
                    data: applyQuery()[0] || null,
                    error: null
                });
            },
            upsert(payload, options = {}) {
                const rows = Array.isArray(payload) ? payload : [payload];
                state.calls.push({
                    table,
                    mode: 'upsert',
                    payload: clone(rows),
                    options
                });
                state.tables[table] = Array.isArray(state.tables[table]) ? state.tables[table] : [];

                rows.forEach((row) => {
                    const index = state.tables[table].findIndex((existing) => (
                        String(existing?.order_id || '') === String(row?.order_id || '')
                        && String(existing?.dedupe_key || '') === String(row?.dedupe_key || '')
                    ));
                    if (index >= 0) {
                        state.tables[table][index] = { ...state.tables[table][index], ...row };
                    } else {
                        state.tables[table].push({
                            id: `ledger_${state.tables[table].length + 1}`,
                            ...row
                        });
                    }
                });

                return Promise.resolve({
                    data: clone(rows),
                    error: null
                });
            },
            then(resolve, reject) {
                return Promise.resolve({
                    data: applyQuery(),
                    error: null
                }).then(resolve, reject);
            }
        };

        return builder;
    }

    return {
        state,
        supabase: {
            from(table) {
                state.tables[table] = Array.isArray(state.tables[table]) ? state.tables[table] : [];
                return createQueryBuilder(table);
            }
        }
    };
}

test('syncOrderProfitLedgerByOrderId persists refunded order revenue and cost reversals', async () => {
    const {
        syncOrderProfitLedgerByOrderId
    } = require('../server/api-handlers/admin/shop/_profit-ledger');
    const { supabase, state } = createSupabaseStub({
        shop_orders: [
            {
                id: 'order_1',
                user_id: 'user_1',
                product_id: 'product_1',
                inventory_id: null,
                snapshot_product_name: 'Premium Account',
                price_paid: 100,
                total_price: 100,
                paid_points_spent: 80,
                bonus_points_spent: 20,
                item_count: 1,
                site: 'cn',
                refund_status: 'refunded',
                created_at: '2026-06-06T08:00:00.000Z'
            }
        ],
        shop_order_items: [
            {
                id: 'item_1',
                order_id: 'order_1',
                inventory_id: 'inventory_1',
                snapshot_product_name: 'Premium Account',
                price_paid: 100,
                created_at: '2026-06-06T08:00:01.000Z'
            }
        ],
        shop_inventory: [
            {
                id: 'inventory_1',
                status: 'fault',
                source_batch_id: 'batch_1',
                purchase_unit_cost_cny: 35,
                content: 'account-secret'
            }
        ],
        shop_order_profit_ledger: []
    });

    const result = await syncOrderProfitLedgerByOrderId(supabase, 'order_1', {
        userId: 'admin_1'
    });

    assert.equal(result.synced, true);
    assert.equal(result.source, 'persisted');
    assert.equal(result.attribution.refunded, true);
    assert.equal(result.attribution.recognized_revenue_cny, 0);
    assert.equal(result.attribution.recognized_cost_cny, 0);
    assert.equal(result.attribution.profit_ledger_status, 'settled');

    const ledgerRows = state.tables.shop_order_profit_ledger;
    assert.equal(ledgerRows.some((row) => row.entry_type === 'revenue_points_paid' && row.status === 'reversed'), true);
    assert.equal(ledgerRows.some((row) => row.entry_type === 'inventory_cost' && row.status === 'reversed' && row.cash_value_cny === -35), true);
    assert.equal(ledgerRows.some((row) => row.entry_type === 'refund_reversal' && row.cash_value_cny === -80), true);
    assert.equal(ledgerRows.some((row) => row.entry_type === 'inventory_cost_reversal' && row.cash_value_cny === 35), true);
    assert.equal(ledgerRows.every((row) => row.created_by === 'admin_1'), true);

    const upsertCall = state.calls.find((call) => call.table === 'shop_order_profit_ledger' && call.mode === 'upsert');
    assert.equal(upsertCall?.options?.onConflict, 'order_id,dedupe_key');
});

test('syncOrderProfitLedgerByOrderId prefers wallet point lot consumption cash value', async () => {
    const {
        syncOrderProfitLedgerByOrderId
    } = require('../server/api-handlers/admin/shop/_profit-ledger');
    const { supabase, state } = createSupabaseStub({
        shop_orders: [
            {
                id: 'order_lot_1',
                user_id: 'user_1',
                product_id: 'product_1',
                inventory_id: null,
                snapshot_product_name: 'Premium Account',
                price_paid: 100,
                total_price: 100,
                paid_points_spent: 100,
                bonus_points_spent: 0,
                item_count: 1,
                site: 'cn',
                refund_status: 'none',
                created_at: '2026-06-06T09:00:00.000Z'
            }
        ],
        shop_order_items: [
            {
                id: 'item_lot_1',
                order_id: 'order_lot_1',
                inventory_id: 'inventory_lot_1',
                snapshot_product_name: 'Premium Account',
                price_paid: 100,
                created_at: '2026-06-06T09:00:01.000Z'
            }
        ],
        shop_inventory: [
            {
                id: 'inventory_lot_1',
                status: 'sold',
                source_batch_id: 'batch_1',
                purchase_unit_cost_cny: 25,
                content: 'account-secret'
            }
        ],
        wallet_point_lot_consumptions: [
            {
                id: 'consumption_paid_1',
                point_lot_id: 'lot_paid_1',
                order_id: 'order_lot_1',
                order_item_id: 'item_lot_1',
                points_amount: 70,
                cash_value_cny: 70,
                source_type: 'recharge',
                source_label: '余额充值',
                consumed_at: '2026-06-06T09:00:02.000Z'
            },
            {
                id: 'consumption_bonus_1',
                point_lot_id: 'lot_bonus_1',
                order_id: 'order_lot_1',
                order_item_id: 'item_lot_1',
                points_amount: 30,
                cash_value_cny: 0,
                source_type: 'activity_bonus',
                source_label: '活动赠送',
                consumed_at: '2026-06-06T09:00:03.000Z'
            }
        ],
        shop_order_profit_ledger: []
    });

    const result = await syncOrderProfitLedgerByOrderId(supabase, 'order_lot_1', {
        userId: 'admin_1'
    });

    assert.equal(result.synced, true);
    assert.equal(result.attribution.basis, 'wallet_point_lot_consumptions');
    assert.equal(result.attribution.recognized_revenue_cny, 70);
    assert.equal(result.attribution.non_cash_points, 30);
    assert.equal(result.attribution.net_profit_cny, 45);
    assert.equal(result.attribution.profit_adjustments.point_lot_consumption_summary.source_types.includes('activity_bonus'), true);

    const ledgerRows = state.tables.shop_order_profit_ledger;
    assert.equal(ledgerRows.some((row) => row.entry_type === 'revenue_points_paid' && row.cash_value_cny === 70), true);
    assert.equal(ledgerRows.some((row) => row.entry_type === 'revenue_points_bonus' && row.points_amount === 30), true);
    assert.equal(ledgerRows.some((row) => row.entry_type === 'inventory_cost' && row.cash_value_cny === -25), true);
});
