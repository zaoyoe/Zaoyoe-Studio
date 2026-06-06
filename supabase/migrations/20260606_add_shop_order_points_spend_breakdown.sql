-- Persist the paid/bonus balance split used by each shop order.
-- This lets profit reports distinguish cash-backed paid points from bonus or
-- reward points instead of treating every consumed point as cash revenue.

ALTER TABLE public.shop_orders
    ADD COLUMN IF NOT EXISTS paid_points_spent NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS bonus_points_spent NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS points_spend_breakdown JSONB NOT NULL DEFAULT '{}'::JSONB;

COMMENT ON COLUMN public.shop_orders.paid_points_spent IS
    'Paid-balance points deducted by this order at purchase time. NULL means historical/untracked.';
COMMENT ON COLUMN public.shop_orders.bonus_points_spent IS
    'Bonus-balance points deducted by this order at purchase time. NULL means historical/untracked.';
COMMENT ON COLUMN public.shop_orders.points_spend_breakdown IS
    'Audit metadata for order point-source attribution, e.g. exact balance split or historical untracked status.';

CREATE INDEX IF NOT EXISTS idx_shop_orders_points_spend_breakdown_status
    ON public.shop_orders ((points_spend_breakdown ->> 'status'));

UPDATE public.shop_orders
SET points_spend_breakdown = jsonb_build_object(
        'status', 'historical_untracked',
        'basis', 'created_before_points_spend_split',
        'note', '该订单创建时尚未记录付费/奖励积分扣款拆分，利润只能按旧口径估算。'
    )
WHERE paid_points_spent IS NULL
  AND bonus_points_spent IS NULL
  AND COALESCE(points_spend_breakdown, '{}'::JSONB) = '{}'::JSONB;

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

    IF POSITION('v_spent_bonus_points NUMERIC(12,2) := 0;' IN v_definition) = 0 THEN
        v_definition := REPLACE(
            v_definition,
            'v_balance_paid NUMERIC(12,2) := 0;',
            'v_balance_paid NUMERIC(12,2) := 0;' || E'\n    v_spent_bonus_points NUMERIC(12,2) := 0;' || E'\n    v_spent_paid_points NUMERIC(12,2) := 0;'
        );
    END IF;

    IF POSITION('v_spent_bonus_points := v_deduct_bonus;' IN v_definition) = 0 THEN
        v_definition := REPLACE(
            v_definition,
            '            UPDATE public.points_balance' || E'\n            SET bonus_balance = ROUND(bonus_balance - v_deduct_bonus, 2),',
            '            v_spent_bonus_points := v_deduct_bonus;' || E'\n            v_spent_paid_points := v_deduct_paid;' || E'\n' || E'\n            UPDATE public.points_balance' || E'\n            SET bonus_balance = ROUND(bonus_balance - v_deduct_bonus, 2),'
        );
    END IF;

    IF POSITION('paid_points_spent,' IN v_definition) = 0 THEN
        v_definition := REPLACE(
            v_definition,
            '        price_paid,' || E'\n        total_price,',
            '        price_paid,' || E'\n        paid_points_spent,' || E'\n        bonus_points_spent,' || E'\n        points_spend_breakdown,' || E'\n        total_price,'
        );
    END IF;

    IF POSITION('v_spent_paid_points,' IN v_definition) = 0 THEN
        v_definition := REPLACE(
            v_definition,
            '        v_total_price,' || E'\n        v_gross_total,',
            '        v_total_price,' || E'\n        v_spent_paid_points,' || E'\n        v_spent_bonus_points,' || E'\n        jsonb_build_object(' || E'\n            ''status'', ''exact'',' || E'\n            ''basis'', ''points_balance_deduction'',' || E'\n            ''paid_points'', v_spent_paid_points,' || E'\n            ''bonus_points'', v_spent_bonus_points,' || E'\n            ''untracked_points'', 0' || E'\n        ),' || E'\n        v_gross_total,'
        );
    END IF;

    IF POSITION('''paid_points_spent'', v_spent_paid_points' IN v_definition) = 0 THEN
        v_definition := REPLACE(
            v_definition,
            '            ''final_total'', v_total_price,' || E'\n            ''unit_price'', v_actual_unit_price,',
            '            ''final_total'', v_total_price,' || E'\n            ''paid_points_spent'', v_spent_paid_points,' || E'\n            ''bonus_points_spent'', v_spent_bonus_points,' || E'\n            ''points_spend_breakdown'', jsonb_build_object(' || E'\n                ''status'', ''exact'',' || E'\n                ''basis'', ''points_balance_deduction'',' || E'\n                ''paid_points'', v_spent_paid_points,' || E'\n                ''bonus_points'', v_spent_bonus_points,' || E'\n                ''untracked_points'', 0' || E'\n            ),' || E'\n            ''unit_price'', v_actual_unit_price,'
        );
    END IF;

    IF POSITION('v_spent_bonus_points NUMERIC(12,2) := 0;' IN v_definition) = 0
        OR POSITION('v_spent_paid_points NUMERIC(12,2) := 0;' IN v_definition) = 0
        OR POSITION('v_spent_bonus_points := v_deduct_bonus;' IN v_definition) = 0
        OR POSITION('paid_points_spent,' IN v_definition) = 0
        OR POSITION('bonus_points_spent,' IN v_definition) = 0
        OR POSITION('points_spend_breakdown,' IN v_definition) = 0
        OR POSITION('''paid_points_spent'', v_spent_paid_points' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'failed to patch fn_purchase_shop_item_core with point spend breakdown';
    END IF;

    EXECUTE v_definition;
END;
$$;

DROP FUNCTION IF EXISTS public.fn_admin_refund_order(UUID, UUID);
DROP FUNCTION IF EXISTS public.fn_admin_refund_order(UUID, UUID, VARCHAR);
DROP FUNCTION IF EXISTS public.fn_admin_refund_order(UUID, UUID, VARCHAR, TEXT);

CREATE OR REPLACE FUNCTION public.fn_admin_refund_order(
    p_order_id UUID,
    p_admin_id UUID,
    p_target_status VARCHAR DEFAULT 'frozen',
    p_remark TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order RECORD;
    v_status_map JSONB := '{"available":"在售","frozen":"冻结","fault":"故障","reserve":"保留"}'::JSONB;
    v_site VARCHAR(10);
    v_refund_reference TEXT;
    v_refund_reason TEXT;
    v_refund_amount NUMERIC(12,2);
    v_refund_paid_points NUMERIC(12,2) := 0;
    v_refund_bonus_points NUMERIC(12,2) := 0;
    v_refund_untracked_points NUMERIC(12,2) := 0;
    v_refund_total_points NUMERIC(12,2) := 0;
    v_recharge_result JSONB := '{}'::JSONB;
    v_inventory_ids UUID[];
    v_stock_count INT := 0;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    IF p_order_id IS NULL THEN
        RAISE EXCEPTION 'p_order_id is required';
    END IF;

    IF p_admin_id IS NULL THEN
        RAISE EXCEPTION 'p_admin_id is required';
    END IF;

    IF NOT (v_status_map ? COALESCE(p_target_status, '')) THEN
        RETURN jsonb_build_object('success', false, 'message', '无效的目标状态');
    END IF;

    SELECT
        o.id,
        o.user_id,
        o.product_id,
        o.inventory_id,
        o.sku_id,
        o.price_paid,
        o.total_price,
        o.snapshot_product_name,
        o.refund_status,
        o.delivery_status,
        o.delivery_completed_at,
        o.site,
        o.paid_points_spent,
        o.bonus_points_spent,
        o.points_spend_breakdown
    INTO v_order
    FROM public.shop_orders o
    WHERE o.id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', '订单不存在');
    END IF;

    v_site := COALESCE(NULLIF(BTRIM(v_order.site), ''), 'cn');
    v_refund_reference := 'REFUND_' || p_order_id::TEXT;
    v_refund_amount := ROUND(GREATEST(COALESCE(v_order.price_paid, 0), 0), 2);

    IF COALESCE(v_order.refund_status, 'none') IN ('refunded', 'full_refund') THEN
        RETURN jsonb_build_object(
            'success', true,
            'duplicate', true,
            'site', v_site,
            'message', '该订单已退款'
        );
    END IF;

    v_refund_paid_points := ROUND(GREATEST(COALESCE(v_order.paid_points_spent, v_refund_amount), 0), 2);
    v_refund_bonus_points := ROUND(GREATEST(COALESCE(v_order.bonus_points_spent, 0), 0), 2);
    v_refund_total_points := ROUND(v_refund_paid_points + v_refund_bonus_points, 2);

    IF ABS(v_refund_total_points - v_refund_amount) > 0.01 THEN
        IF v_order.paid_points_spent IS NULL AND v_order.bonus_points_spent IS NULL THEN
            v_refund_paid_points := v_refund_amount;
            v_refund_bonus_points := 0;
        ELSIF v_refund_total_points < v_refund_amount THEN
            v_refund_untracked_points := ROUND(v_refund_amount - v_refund_total_points, 2);
            v_refund_paid_points := ROUND(v_refund_paid_points + v_refund_untracked_points, 2);
        ELSIF v_refund_total_points > 0 THEN
            v_refund_paid_points := ROUND(v_refund_amount * (v_refund_paid_points / v_refund_total_points), 2);
            v_refund_bonus_points := ROUND(GREATEST(v_refund_amount - v_refund_paid_points, 0), 2);
        END IF;
    END IF;

    IF v_refund_amount > 0 THEN
        v_refund_reason := '订单退款: ' || COALESCE(NULLIF(BTRIM(v_order.snapshot_product_name), ''), '未知商品');

        SELECT public.fn_recharge_points(
            v_order.user_id,
            v_refund_paid_points,
            v_refund_bonus_points,
            v_refund_reason,
            v_refund_reference,
            v_site
        )
        INTO v_recharge_result;

        IF COALESCE((v_recharge_result ->> 'success')::BOOLEAN, false) IS NOT TRUE THEN
            RETURN jsonb_build_object(
                'success', false,
                'message', COALESCE(v_recharge_result ->> 'message', '退款积分返还失败'),
                'site', v_site
            );
        END IF;
    END IF;

    SELECT ARRAY(
        SELECT DISTINCT inventory_id
        FROM (
            SELECT v_order.inventory_id AS inventory_id
            UNION ALL
            SELECT soi.inventory_id
            FROM public.shop_order_items soi
            WHERE soi.order_id = p_order_id
        ) inventory_rows
        WHERE inventory_id IS NOT NULL
    )
    INTO v_inventory_ids;

    IF COALESCE(array_length(v_inventory_ids, 1), 0) > 0 THEN
        UPDATE public.shop_inventory
        SET status = p_target_status,
            remark = COALESCE(NULLIF(BTRIM(p_remark), ''), remark),
            buyer_id = NULL,
            sold_at = NULL
        WHERE id = ANY(v_inventory_ids);
    END IF;

    UPDATE public.shop_orders
    SET refund_status = 'refunded',
        delivery_status = 'refunded',
        delivery_completed_at = COALESCE(delivery_completed_at, NOW()),
        delivery_updated_at = NOW(),
        points_spend_breakdown = COALESCE(points_spend_breakdown, '{}'::JSONB) || jsonb_build_object(
            'refund_status', 'refunded',
            'refund_paid_points', v_refund_paid_points,
            'refund_bonus_points', v_refund_bonus_points,
            'refund_reference', v_refund_reference
        )
    WHERE id = p_order_id;

    SELECT COUNT(*)
    INTO v_stock_count
    FROM public.shop_inventory
    WHERE product_id = v_order.product_id
      AND status = 'available';

    UPDATE public.shop_products
    SET stock_count = v_stock_count
    WHERE id = v_order.product_id;

    IF v_order.sku_id IS NOT NULL
        AND to_regprocedure('public.fn_sync_shop_product_sku_stock_counts(uuid[])') IS NOT NULL THEN
        EXECUTE 'SELECT public.fn_sync_shop_product_sku_stock_counts($1::uuid[])'
        USING ARRAY[v_order.sku_id];
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'site', v_site,
        'duplicate', false,
        'refund_paid_points', v_refund_paid_points,
        'refund_bonus_points', v_refund_bonus_points,
        'message', '退款成功，库存已标记为: ' || (v_status_map ->> p_target_status)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_admin_refund_order(UUID, UUID, VARCHAR, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_admin_refund_order(UUID, UUID, VARCHAR, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.fn_admin_refund_order(UUID, UUID, VARCHAR, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_admin_refund_order(UUID, UUID, VARCHAR, TEXT) TO service_role;
