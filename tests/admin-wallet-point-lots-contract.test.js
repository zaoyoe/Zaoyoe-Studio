const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('wallet point lots migration defines source lots and order consumption tracking', () => {
    const migration = fs.readFileSync(
        path.join(__dirname, '..', 'supabase', 'migrations', '20260606_add_wallet_point_lots.sql'),
        'utf8'
    );

    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.wallet_point_lots/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.wallet_point_lot_consumptions/);
    assert.match(migration, /source_type IN \([\s\S]*'recharge'[\s\S]*'redemption_code'[\s\S]*'activity_bonus'[\s\S]*'admin_grant'[\s\S]*'affiliate_commission'[\s\S]*'refund_return'/);
    assert.match(migration, /cash_value_rate NUMERIC\(12,6\) NOT NULL DEFAULT 0/);
    assert.match(migration, /cash_value_cny NUMERIC\(14,4\) NOT NULL DEFAULT 0/);
    assert.match(migration, /idx_wallet_point_lot_consumptions_order/);
    assert.match(migration, /ALTER TABLE public\.wallet_point_lots ENABLE ROW LEVEL SECURITY/);
    assert.match(migration, /ALTER TABLE public\.wallet_point_lot_consumptions ENABLE ROW LEVEL SECURITY/);
    assert.match(migration, /Admins manage wallet point lots/);
});

test('shop profit attribution can read wallet point lot consumption summaries', () => {
    const profitSource = fs.readFileSync(
        path.join(__dirname, '..', 'server', 'api-handlers', 'admin', 'shop', '_profit.js'),
        'utf8'
    );
    const pointLotsSource = fs.readFileSync(
        path.join(__dirname, '..', 'server', 'api-handlers', 'admin', 'shop', '_point-lots.js'),
        'utf8'
    );

    assert.match(pointLotsSource, /wallet_point_lot_consumptions/);
    assert.match(pointLotsSource, /cash_backed_points/);
    assert.match(pointLotsSource, /non_cash_points/);
    assert.match(profitSource, /basis: 'wallet_point_lot_consumptions'/);
    assert.match(profitSource, /recognized_cash_revenue_cny: cashValueCny/);
});

test('wallet point lots inflow migration wires recharge and redemption sources into lots', () => {
    const migration = fs.readFileSync(
        path.join(__dirname, '..', 'supabase', 'migrations', '20260606_wire_wallet_point_lots_to_inflows.sql'),
        'utf8'
    );

    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.fn_classify_wallet_point_lot_source/);
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.fn_create_wallet_point_lot/);
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.fn_recharge_points\(\s*target_user_id UUID,[\s\S]*p_site VARCHAR DEFAULT 'cn'/);
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.fn_redeem_code\(\s*p_code VARCHAR,\s*p_site VARCHAR DEFAULT 'cn'/);
    assert.match(migration, /v_reference LIKE 'REFUND_%'[\s\S]*RETURN 'refund_return'/);
    assert.match(migration, /v_reference LIKE 'REDEEM_%'[\s\S]*RETURN 'redemption_code'/);
    assert.match(migration, /v_reference LIKE 'REG_REWARD_%'[\s\S]*RETURN 'affiliate_commission'/);
    assert.match(migration, /PERFORM public\.fn_create_wallet_point_lot\([\s\S]*target_user_id[\s\S]*v_site[\s\S]*v_source_type[\s\S]*v_paid[\s\S]*v_paid/);
    assert.match(migration, /PERFORM public\.fn_create_wallet_point_lot\([\s\S]*v_user_id[\s\S]*v_site[\s\S]*'redemption_code'[\s\S]*v_points_amount[\s\S]*v_points_amount/);
    assert.match(migration, /COALESCE\(auth\.role\(\), ''\) NOT IN \('service_role', 'authenticated'\)/);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.fn_create_wallet_point_lot\(UUID, VARCHAR, VARCHAR, TEXT, TEXT, NUMERIC, NUMERIC, VARCHAR, UUID, JSONB\) TO service_role/);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.fn_redeem_code\(VARCHAR, VARCHAR\) TO authenticated/);
});

test('shop purchase migration consumes wallet point lots after points ledger spend', () => {
    const migration = fs.readFileSync(
        path.join(__dirname, '..', 'supabase', 'migrations', '202606061730_consume_wallet_point_lots_on_shop_purchase.sql'),
        'utf8'
    );

    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.fn_consume_wallet_point_lots_for_shop_order/);
    assert.match(migration, /FROM public\.wallet_point_lots[\s\S]*FOR UPDATE SKIP LOCKED/);
    assert.match(migration, /UPDATE public\.wallet_point_lots[\s\S]*points_remaining = ROUND\(points_remaining - v_take_points, 2\)/);
    assert.match(migration, /INSERT INTO public\.wallet_point_lot_consumptions/);
    assert.match(migration, /metadata ->> 'component' = 'bonus'/);
    assert.match(migration, /metadata ->> 'component' = 'paid'/);
    assert.match(migration, /source_type IN \('checkin', 'activity_bonus', 'admin_grant', 'affiliate_commission', 'migration', 'unknown'\)/);
    assert.match(migration, /IN \('recharge', 'redemption_code'\)/);
    assert.match(migration, /COALESCE\(NULLIF\(BTRIM\(v_lot\.source_type\), ''\), 'unknown'\) = 'refund_return'/);
    assert.match(migration, /'paid_points_untracked'/);
    assert.match(migration, /'bonus_points_untracked'/);
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.fn_consume_wallet_point_lots_for_shop_order\(UUID, VARCHAR, UUID, UUID, NUMERIC, NUMERIC, TEXT, TEXT\) FROM authenticated/);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.fn_consume_wallet_point_lots_for_shop_order\(UUID, VARCHAR, UUID, UUID, NUMERIC, NUMERIC, TEXT, TEXT\) TO service_role/);
    assert.match(migration, /public\.fn_purchase_shop_item_core\(uuid,uuid,character varying,integer,character varying,uuid,uuid\)/);
    assert.match(migration, /v_purchase_ledger_id UUID := NULL/);
    assert.match(migration, /RETURNING id INTO v_purchase_ledger_id/);
    assert.match(migration, /PERFORM public\.fn_consume_wallet_point_lots_for_shop_order\(/);
    assert.equal(migration.includes('v_spent_paid_points,'), true);
    assert.equal(migration.includes('v_spent_bonus_points,'), true);
    assert.match(migration, /20260606_add_shop_order_points_spend_breakdown\.sql first/);
});

test('balance backfill migration creates idempotent migration lots from current balances', () => {
    const migration = fs.readFileSync(
        path.join(__dirname, '..', 'supabase', 'migrations', '202606061830_backfill_wallet_point_lots_from_balances.sql'),
        'utf8'
    );

    assert.match(migration, /FROM public\.points_balance b/);
    assert.match(migration, /INNER JOIN public\.profiles p ON p\.id = b\.user_id/);
    assert.match(migration, /public\.wallet_point_lots/);
    assert.match(migration, /paid_balance/);
    assert.match(migration, /bonus_balance/);
    assert.match(migration, /LOWER\(BTRIM\(COALESCE\(b\.site, 'cn'\)\)\) = 'intl'/);
    assert.match(migration, /tracked_paid_remaining/);
    assert.match(migration, /tracked_bonus_remaining/);
    assert.match(migration, /paid_gap/);
    assert.match(migration, /bonus_gap/);
    assert.match(migration, /source_type,\s*source_label,\s*source_reference_id/);
    assert.match(migration, /'migration',\s*'迁移期付费余额'/);
    assert.match(migration, /'migration',\s*'迁移期赠送余额'/);
    assert.match(migration, /'BALANCE_MIGRATION_' \|\| g\.site \|\| '_' \|\| g\.user_id::TEXT \|\| '_paid'/);
    assert.match(migration, /'BALANCE_MIGRATION_' \|\| g\.site \|\| '_' \|\| g\.user_id::TEXT \|\| '_bonus'/);
    assert.match(migration, /cash_value_cny,[\s\S]*cash_value_rate/);
    assert.match(migration, /g\.paid_gap,\s*1,\s*'CNY'/);
    assert.match(migration, /g\.bonus_gap,\s*g\.bonus_gap,\s*0,\s*0,\s*'CNY'/);
    assert.match(migration, /NOT EXISTS \([\s\S]*existing\.source_type = 'migration'[\s\S]*existing\.source_reference_id = 'BALANCE_MIGRATION_'/);
    assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_point_lots_balance_migration_ref/);
    assert.match(migration, /metadata[\s\S]*'component', 'paid'/);
    assert.match(migration, /metadata[\s\S]*'component', 'bonus'/);
    assert.match(migration, /'created_by_migration', '202606061830_backfill_wallet_point_lots_from_balances'/);
});

test('migration point lots use cash value to distinguish paid and non-cash legacy balances', () => {
    const { normalizePointLotConsumptionRow, summarizePointLotConsumptions } = require('../server/api-handlers/admin/shop/_point-lots');

    const paidMigrationRow = normalizePointLotConsumptionRow({
        source_type: 'migration',
        points_amount: 35,
        cash_value_cny: 35
    });
    const bonusMigrationRow = normalizePointLotConsumptionRow({
        source_type: 'migration',
        points_amount: 15,
        cash_value_cny: 0
    });
    const summary = summarizePointLotConsumptions([paidMigrationRow, bonusMigrationRow], 50);

    assert.equal(paidMigrationRow.cash_treatment, 'cash_backed');
    assert.equal(bonusMigrationRow.cash_treatment, 'non_cash');
    assert.equal(summary.cash_backed_points, 35);
    assert.equal(summary.non_cash_points, 15);
    assert.equal(summary.cash_value_cny, 35);
});

test('refund-return point lots keep cash value treatment when consumed later', () => {
    const { normalizePointLotConsumptionRow, summarizePointLotConsumptions } = require('../server/api-handlers/admin/shop/_point-lots');

    const cashRefundRow = normalizePointLotConsumptionRow({
        source_type: 'refund_return',
        points_amount: 12,
        cash_value_cny: 12
    });
    const bonusRefundRow = normalizePointLotConsumptionRow({
        source_type: 'refund_return',
        points_amount: 8,
        cash_value_cny: 0
    });
    const summary = summarizePointLotConsumptions([cashRefundRow, bonusRefundRow], 20);

    assert.equal(cashRefundRow.cash_treatment, 'cash_backed');
    assert.equal(bonusRefundRow.cash_treatment, 'non_cash');
    assert.equal(summary.cash_backed_points, 12);
    assert.equal(summary.non_cash_points, 8);
    assert.equal(summary.cash_value_cny, 12);
});

test('admin granted point lots are not counted as cash revenue even if legacy rows carry cash value', () => {
    const { summarizePointLotConsumptions } = require('../server/api-handlers/admin/shop/_point-lots');

    const summary = summarizePointLotConsumptions([
        {
            source_type: 'admin_grant',
            points_amount: 10,
            cash_value_cny: 10
        },
        {
            source_type: 'recharge',
            points_amount: 20,
            cash_value_cny: 20
        }
    ], 30);

    assert.equal(summary.cash_backed_points, 20);
    assert.equal(summary.non_cash_points, 10);
    assert.equal(summary.cash_value_cny, 20);
});

test('shop profit attribution exposes point-source traceability states', () => {
    const { buildOrderProfitAttribution } = require('../server/api-handlers/admin/shop/_profit');

    const traced = buildOrderProfitAttribution({
        id: 'order_traced',
        price_paid: 30,
        total_price: 30,
        created_at: '2026-06-06T09:00:00.000Z'
    }, [], {
        pointLotSummary: {
            item_count: 2,
            total_points: 30,
            cash_backed_points: 20,
            non_cash_points: 10,
            unknown_points: 0,
            untracked_points: 0,
            cash_value_cny: 20,
            source_types: ['recharge', 'activity_bonus']
        }
    });
    const splitOnly = buildOrderProfitAttribution({
        id: 'order_split',
        price_paid: 30,
        total_price: 30,
        paid_points_spent: 20,
        bonus_points_spent: 10,
        points_spend_breakdown: {
            status: 'exact',
            paid_points: 20,
            bonus_points: 10,
            untracked_points: 0
        }
    }, []);
    const legacy = buildOrderProfitAttribution({
        id: 'order_legacy',
        price_paid: 30,
        total_price: 30
    }, []);

    assert.equal(traced.point_source_traceability.status, 'source_lot_exact');
    assert.equal(traced.point_source_traceability.label, '来源批次完整');
    assert.equal(traced.point_source_traceability.cash_backed_points, 20);
    assert.equal(traced.point_source_traceability.non_cash_points, 10);
    assert.equal(splitOnly.point_source_traceability.status, 'balance_split_only');
    assert.equal(splitOnly.point_source_traceability.label, '仅余额拆分');
    assert.equal(splitOnly.point_source_traceability.action_required, false);
    assert.equal(legacy.point_source_traceability.status, 'legacy_untracked');
    assert.equal(legacy.point_source_traceability.label, '历史未拆分');
    assert.equal(legacy.point_source_traceability.action_required, true);
});
