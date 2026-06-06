-- Consume wallet point lots when a shop order deducts points.
-- This links each new shop purchase to the exact point-source lots it spent,
-- so profit reports can distinguish cash-backed revenue from non-cash points.

CREATE INDEX IF NOT EXISTS idx_wallet_point_lot_consumptions_order_ref
    ON public.wallet_point_lot_consumptions (order_id, consumption_reference_id)
    WHERE order_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_consume_wallet_point_lots_for_shop_order(
    p_user_id UUID,
    p_site VARCHAR,
    p_order_id UUID,
    p_ledger_id UUID DEFAULT NULL,
    p_paid_points NUMERIC DEFAULT 0,
    p_bonus_points NUMERIC DEFAULT 0,
    p_consumption_reference_id TEXT DEFAULT NULL,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_site VARCHAR(16) := COALESCE(NULLIF(BTRIM(p_site), ''), 'cn');
    v_reference_id TEXT := COALESCE(NULLIF(BTRIM(p_consumption_reference_id), ''), 'SHOP_ORDER_' || p_order_id::TEXT);
    v_paid_remaining NUMERIC(14,2) := ROUND(GREATEST(COALESCE(p_paid_points, 0), 0), 2);
    v_bonus_remaining NUMERIC(14,2) := ROUND(GREATEST(COALESCE(p_bonus_points, 0), 0), 2);
    v_expected_points NUMERIC(14,2) := 0;
    v_existing_count INT := 0;
    v_consumed_points NUMERIC(14,2) := 0;
    v_cash_value_cny NUMERIC(14,4) := 0;
    v_lot RECORD;
    v_take_points NUMERIC(14,2) := 0;
BEGIN
    IF COALESCE(auth.role(), '') NOT IN ('service_role', 'authenticated') THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'p_user_id is required';
    END IF;

    IF p_order_id IS NULL THEN
        RAISE EXCEPTION 'p_order_id is required';
    END IF;

    v_expected_points := ROUND(v_paid_remaining + v_bonus_remaining, 2);
    IF v_expected_points <= 0 THEN
        RETURN jsonb_build_object(
            'success', true,
            'status', 'empty',
            'order_id', p_order_id,
            'expected_points', 0,
            'consumed_points', 0,
            'untracked_points', 0,
            'cash_value_cny', 0
        );
    END IF;

    SELECT
        COUNT(*)::INT,
        ROUND(COALESCE(SUM(points_amount), 0), 2),
        ROUND(COALESCE(SUM(cash_value_cny), 0), 4)
    INTO
        v_existing_count,
        v_consumed_points,
        v_cash_value_cny
    FROM public.wallet_point_lot_consumptions
    WHERE order_id = p_order_id
      AND consumption_reference_id = v_reference_id;

    IF v_existing_count > 0 THEN
        RETURN jsonb_build_object(
            'success', true,
            'status', CASE
                WHEN ROUND(GREATEST(v_expected_points - v_consumed_points, 0), 2) > 0 THEN 'partial'
                ELSE 'exact'
            END,
            'order_id', p_order_id,
            'reference_id', v_reference_id,
            'expected_points', v_expected_points,
            'consumed_points', v_consumed_points,
            'untracked_points', ROUND(GREATEST(v_expected_points - v_consumed_points, 0), 2),
            'cash_value_cny', v_cash_value_cny,
            'idempotent', true
        );
    END IF;

    IF v_bonus_remaining > 0 THEN
        FOR v_lot IN
            SELECT
                id,
                points_remaining,
                cash_value_rate,
                source_type,
                source_label,
                metadata
            FROM public.wallet_point_lots
            WHERE user_id = p_user_id
              AND site = v_site
              AND points_remaining > 0
              AND (
                  metadata ->> 'component' = 'bonus'
                  OR (
                      COALESCE(metadata ->> 'component', '') = ''
                      AND source_type IN ('checkin', 'activity_bonus', 'admin_grant', 'affiliate_commission', 'migration', 'unknown')
                      AND COALESCE(cash_value_rate, 0) <= 0
                  )
              )
            ORDER BY
                acquired_at ASC,
                created_at ASC,
                id ASC
            FOR UPDATE SKIP LOCKED
        LOOP
            EXIT WHEN v_bonus_remaining <= 0;

            v_take_points := LEAST(v_bonus_remaining, ROUND(COALESCE(v_lot.points_remaining, 0), 2));
            IF v_take_points <= 0 THEN
                CONTINUE;
            END IF;

            UPDATE public.wallet_point_lots
            SET points_remaining = ROUND(points_remaining - v_take_points, 2),
                updated_at = NOW()
            WHERE id = v_lot.id;

            INSERT INTO public.wallet_point_lot_consumptions (
                point_lot_id,
                user_id,
                site,
                order_id,
                ledger_id,
                consumption_reference_id,
                points_amount,
                cash_value_cny,
                source_type,
                source_label,
                metadata
            )
            VALUES (
                v_lot.id,
                p_user_id,
                v_site,
                p_order_id,
                p_ledger_id,
                v_reference_id,
                v_take_points,
                CASE
                    WHEN COALESCE(NULLIF(BTRIM(v_lot.source_type), ''), 'unknown') IN ('recharge', 'redemption_code')
                        OR (
                            COALESCE(NULLIF(BTRIM(v_lot.source_type), ''), 'unknown') = 'refund_return'
                            AND GREATEST(COALESCE(v_lot.cash_value_rate, 0), 0) > 0
                        )
                    THEN ROUND(v_take_points * GREATEST(COALESCE(v_lot.cash_value_rate, 0), 0), 4)
                    ELSE 0
                END,
                COALESCE(NULLIF(BTRIM(v_lot.source_type), ''), 'unknown'),
                v_lot.source_label,
                jsonb_build_object(
                    'requested_bucket', 'bonus',
                    'requested_paid_points', ROUND(GREATEST(COALESCE(p_paid_points, 0), 0), 2),
                    'requested_bonus_points', ROUND(GREATEST(COALESCE(p_bonus_points, 0), 0), 2),
                    'reason', p_reason
                )
            );

            v_bonus_remaining := ROUND(v_bonus_remaining - v_take_points, 2);
        END LOOP;
    END IF;

    IF v_paid_remaining > 0 THEN
        FOR v_lot IN
            SELECT
                id,
                points_remaining,
                cash_value_rate,
                source_type,
                source_label,
                metadata
            FROM public.wallet_point_lots
            WHERE user_id = p_user_id
              AND site = v_site
              AND points_remaining > 0
              AND (
                  metadata ->> 'component' = 'paid'
                  OR source_type IN ('recharge', 'redemption_code')
                  OR (
                      source_type = 'refund_return'
                      AND COALESCE(cash_value_rate, 0) > 0
                  )
                  OR (
                      COALESCE(metadata ->> 'component', '') = ''
                      AND COALESCE(cash_value_rate, 0) > 0
                  )
              )
            ORDER BY
                acquired_at ASC,
                created_at ASC,
                id ASC
            FOR UPDATE SKIP LOCKED
        LOOP
            EXIT WHEN v_paid_remaining <= 0;

            v_take_points := LEAST(v_paid_remaining, ROUND(COALESCE(v_lot.points_remaining, 0), 2));
            IF v_take_points <= 0 THEN
                CONTINUE;
            END IF;

            UPDATE public.wallet_point_lots
            SET points_remaining = ROUND(points_remaining - v_take_points, 2),
                updated_at = NOW()
            WHERE id = v_lot.id;

            INSERT INTO public.wallet_point_lot_consumptions (
                point_lot_id,
                user_id,
                site,
                order_id,
                ledger_id,
                consumption_reference_id,
                points_amount,
                cash_value_cny,
                source_type,
                source_label,
                metadata
            )
            VALUES (
                v_lot.id,
                p_user_id,
                v_site,
                p_order_id,
                p_ledger_id,
                v_reference_id,
                v_take_points,
                CASE
                    WHEN COALESCE(NULLIF(BTRIM(v_lot.source_type), ''), 'unknown') IN ('recharge', 'redemption_code')
                        OR (
                            COALESCE(NULLIF(BTRIM(v_lot.source_type), ''), 'unknown') = 'refund_return'
                            AND GREATEST(COALESCE(v_lot.cash_value_rate, 0), 0) > 0
                        )
                    THEN ROUND(v_take_points * GREATEST(COALESCE(v_lot.cash_value_rate, 0), 0), 4)
                    ELSE 0
                END,
                COALESCE(NULLIF(BTRIM(v_lot.source_type), ''), 'unknown'),
                v_lot.source_label,
                jsonb_build_object(
                    'requested_bucket', 'paid',
                    'requested_paid_points', ROUND(GREATEST(COALESCE(p_paid_points, 0), 0), 2),
                    'requested_bonus_points', ROUND(GREATEST(COALESCE(p_bonus_points, 0), 0), 2),
                    'reason', p_reason
                )
            );

            v_paid_remaining := ROUND(v_paid_remaining - v_take_points, 2);
        END LOOP;
    END IF;

    SELECT
        ROUND(COALESCE(SUM(points_amount), 0), 2),
        ROUND(COALESCE(SUM(cash_value_cny), 0), 4)
    INTO
        v_consumed_points,
        v_cash_value_cny
    FROM public.wallet_point_lot_consumptions
    WHERE order_id = p_order_id
      AND consumption_reference_id = v_reference_id;

    RETURN jsonb_build_object(
        'success', true,
        'status', CASE
            WHEN ROUND(GREATEST(v_expected_points - v_consumed_points, 0), 2) > 0 THEN 'partial'
            ELSE 'exact'
        END,
        'order_id', p_order_id,
        'reference_id', v_reference_id,
        'expected_points', v_expected_points,
        'consumed_points', v_consumed_points,
        'paid_points_untracked', v_paid_remaining,
        'bonus_points_untracked', v_bonus_remaining,
        'untracked_points', ROUND(GREATEST(v_expected_points - v_consumed_points, 0), 2),
        'cash_value_cny', v_cash_value_cny
    );
END;
$$;

COMMENT ON FUNCTION public.fn_consume_wallet_point_lots_for_shop_order(UUID, VARCHAR, UUID, UUID, NUMERIC, NUMERIC, TEXT, TEXT) IS
    'Consumes wallet point lots for a shop order after the points ledger spend row is created. Missing legacy lots are left untracked instead of blocking purchase.';

REVOKE ALL ON FUNCTION public.fn_consume_wallet_point_lots_for_shop_order(UUID, VARCHAR, UUID, UUID, NUMERIC, NUMERIC, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_consume_wallet_point_lots_for_shop_order(UUID, VARCHAR, UUID, UUID, NUMERIC, NUMERIC, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.fn_consume_wallet_point_lots_for_shop_order(UUID, VARCHAR, UUID, UUID, NUMERIC, NUMERIC, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_consume_wallet_point_lots_for_shop_order(UUID, VARCHAR, UUID, UUID, NUMERIC, NUMERIC, TEXT, TEXT) TO service_role;

DO $$
DECLARE
    v_definition TEXT;
BEGIN
    SELECT pg_get_functiondef(
        'public.fn_purchase_shop_item_core(uuid,uuid,character varying,integer,character varying,uuid,uuid)'::regprocedure
    )
    INTO v_definition;

    IF v_definition IS NULL THEN
        RAISE EXCEPTION 'fn_purchase_shop_item_core is missing; run 20260523_add_shop_product_skus.sql first';
    END IF;

    IF POSITION('v_spent_paid_points NUMERIC(12,2) := 0;' IN v_definition) = 0
        OR POSITION('v_spent_bonus_points NUMERIC(12,2) := 0;' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'fn_purchase_shop_item_core must be patched by 20260606_add_shop_order_points_spend_breakdown.sql first';
    END IF;

    IF POSITION('v_purchase_ledger_id UUID := NULL;' IN v_definition) = 0 THEN
        v_definition := REPLACE(
            v_definition,
            'v_task_id UUID;',
            'v_task_id UUID;' || E'\n    v_purchase_ledger_id UUID := NULL;'
        );
    END IF;

    IF POSITION('fn_consume_wallet_point_lots_for_shop_order(' IN v_definition) = 0 THEN
        v_definition := REPLACE(
            v_definition,
            '        INSERT INTO public.points_ledger (user_id, amount, reason, reference_id, site)' || E'\n        VALUES (v_effective_user_id, -v_total_price, ''商城购买: '' || v_product.name, ''SHOP_ORDER_'' || v_order_id, v_site);',
            '        INSERT INTO public.points_ledger (user_id, amount, reason, reference_id, site)' || E'\n        VALUES (v_effective_user_id, -v_total_price, ''商城购买: '' || v_product.name, ''SHOP_ORDER_'' || v_order_id, v_site)' || E'\n        RETURNING id INTO v_purchase_ledger_id;' || E'\n' || E'\n        PERFORM public.fn_consume_wallet_point_lots_for_shop_order(' || E'\n            v_effective_user_id,' || E'\n            v_site,' || E'\n            v_order_id,' || E'\n            v_purchase_ledger_id,' || E'\n            v_spent_paid_points,' || E'\n            v_spent_bonus_points,' || E'\n            ''SHOP_ORDER_'' || v_order_id,' || E'\n            ''商城购买: '' || v_product.name' || E'\n        );'
        );
    END IF;

    IF POSITION('v_purchase_ledger_id UUID := NULL;' IN v_definition) = 0
        OR POSITION('RETURNING id INTO v_purchase_ledger_id;' IN v_definition) = 0
        OR POSITION('PERFORM public.fn_consume_wallet_point_lots_for_shop_order(' IN v_definition) = 0
        OR POSITION('v_spent_paid_points,' IN v_definition) = 0
        OR POSITION('v_spent_bonus_points,' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'failed to patch fn_purchase_shop_item_core with wallet point lot consumption';
    END IF;

    EXECUTE v_definition;
END;
$$;
