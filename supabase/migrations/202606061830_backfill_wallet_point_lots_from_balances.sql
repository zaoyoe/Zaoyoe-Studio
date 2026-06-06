-- Backfill wallet point lots from current points_balance rows.
-- This covers pre-lot balances so future shop orders can consume traceable lots.
-- Safe to re-run: it only inserts the positive remaining gap per user/site/bucket.

DO $$
DECLARE
    v_definition TEXT;
BEGIN
    SELECT pg_get_functiondef(
        'public.fn_consume_wallet_point_lots_for_shop_order(uuid,character varying,uuid,uuid,numeric,numeric,text,text)'::regprocedure
    )
    INTO v_definition;

    IF v_definition IS NULL THEN
        RAISE EXCEPTION 'fn_consume_wallet_point_lots_for_shop_order is missing; run 202606061730_consume_wallet_point_lots_on_shop_purchase.sql first';
    END IF;

    IF POSITION('= ''migration''' IN v_definition) = 0 THEN
        v_definition := REPLACE(
            v_definition,
            $needle$COALESCE(NULLIF(BTRIM(v_lot.source_type), ''), 'unknown') = 'refund_return'
                            AND GREATEST(COALESCE(v_lot.cash_value_rate, 0), 0) > 0
                        )$needle$,
            $replacement$COALESCE(NULLIF(BTRIM(v_lot.source_type), ''), 'unknown') = 'refund_return'
                            AND GREATEST(COALESCE(v_lot.cash_value_rate, 0), 0) > 0
                        )
                        OR (
                            COALESCE(NULLIF(BTRIM(v_lot.source_type), ''), 'unknown') = 'migration'
                            AND GREATEST(COALESCE(v_lot.cash_value_rate, 0), 0) > 0
                        )$replacement$
        );
    END IF;

    IF POSITION('= ''migration''' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'failed to patch wallet point lot consumption cash attribution for migration lots';
    END IF;

    EXECUTE v_definition;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_point_lots_balance_migration_ref
    ON public.wallet_point_lots (source_reference_id)
    WHERE source_type = 'migration'
      AND source_reference_id LIKE 'BALANCE_MIGRATION_%';

WITH normalized_balances AS (
    SELECT
        b.user_id,
        CASE
            WHEN LOWER(BTRIM(COALESCE(b.site, 'cn'))) = 'intl' THEN 'intl'
            ELSE 'cn'
        END AS site,
        ROUND(GREATEST(COALESCE(b.paid_balance, 0), 0), 2) AS paid_balance,
        ROUND(GREATEST(COALESCE(b.bonus_balance, 0), 0), 2) AS bonus_balance
    FROM public.points_balance b
    INNER JOIN public.profiles p ON p.id = b.user_id
),
tracked_lots AS (
    SELECT
        l.user_id,
        CASE
            WHEN LOWER(BTRIM(COALESCE(l.site, 'cn'))) = 'intl' THEN 'intl'
            ELSE 'cn'
        END AS site,
        ROUND(COALESCE(SUM(
            CASE
                WHEN COALESCE(l.metadata ->> 'component', '') = 'paid' THEN l.points_remaining
                WHEN COALESCE(l.metadata ->> 'component', '') = 'bonus' THEN 0
                WHEN LOWER(BTRIM(COALESCE(l.source_type, 'unknown'))) IN ('recharge', 'redemption_code') THEN l.points_remaining
                WHEN LOWER(BTRIM(COALESCE(l.source_type, 'unknown'))) IN ('refund_return', 'migration')
                    AND COALESCE(l.cash_value_rate, 0) > 0 THEN l.points_remaining
                WHEN COALESCE(l.cash_value_rate, 0) > 0 THEN l.points_remaining
                ELSE 0
            END
        ), 0), 2) AS tracked_paid_remaining,
        ROUND(COALESCE(SUM(
            CASE
                WHEN COALESCE(l.metadata ->> 'component', '') = 'bonus' THEN l.points_remaining
                WHEN COALESCE(l.metadata ->> 'component', '') = 'paid' THEN 0
                WHEN LOWER(BTRIM(COALESCE(l.source_type, 'unknown'))) IN ('recharge', 'redemption_code') THEN 0
                WHEN LOWER(BTRIM(COALESCE(l.source_type, 'unknown'))) IN ('refund_return', 'migration')
                    AND COALESCE(l.cash_value_rate, 0) > 0 THEN 0
                WHEN COALESCE(l.cash_value_rate, 0) > 0 THEN 0
                ELSE l.points_remaining
            END
        ), 0), 2) AS tracked_bonus_remaining
    FROM public.wallet_point_lots l
    WHERE COALESCE(l.points_remaining, 0) > 0
    GROUP BY l.user_id, CASE
        WHEN LOWER(BTRIM(COALESCE(l.site, 'cn'))) = 'intl' THEN 'intl'
        ELSE 'cn'
    END
),
balance_gaps AS (
    SELECT
        b.user_id,
        b.site,
        b.paid_balance,
        b.bonus_balance,
        COALESCE(t.tracked_paid_remaining, 0) AS tracked_paid_remaining,
        COALESCE(t.tracked_bonus_remaining, 0) AS tracked_bonus_remaining,
        ROUND(GREATEST(b.paid_balance - COALESCE(t.tracked_paid_remaining, 0), 0), 2) AS paid_gap,
        ROUND(GREATEST(b.bonus_balance - COALESCE(t.tracked_bonus_remaining, 0), 0), 2) AS bonus_gap
    FROM normalized_balances b
    LEFT JOIN tracked_lots t
      ON t.user_id = b.user_id
     AND t.site = b.site
)
INSERT INTO public.wallet_point_lots (
    user_id,
    site,
    source_type,
    source_label,
    source_reference_id,
    points_original,
    points_remaining,
    cash_value_cny,
    cash_value_rate,
    currency,
    acquired_at,
    metadata
)
SELECT
    g.user_id,
    g.site,
    'migration',
    '迁移期付费余额',
    'BALANCE_MIGRATION_' || g.site || '_' || g.user_id::TEXT || '_paid',
    g.paid_gap,
    g.paid_gap,
    g.paid_gap,
    1,
    'CNY',
    NOW(),
    jsonb_build_object(
        'component', 'paid',
        'basis', 'points_balance_remaining_backfill',
        'balance_paid_remaining', g.paid_balance,
        'tracked_paid_remaining_before_backfill', g.tracked_paid_remaining,
        'created_by_migration', '202606061830_backfill_wallet_point_lots_from_balances'
    )
FROM balance_gaps g
WHERE g.paid_gap > 0.009
  AND NOT EXISTS (
      SELECT 1
      FROM public.wallet_point_lots existing
      WHERE existing.source_type = 'migration'
        AND existing.source_reference_id = 'BALANCE_MIGRATION_' || g.site || '_' || g.user_id::TEXT || '_paid'
  );

WITH normalized_balances AS (
    SELECT
        b.user_id,
        CASE
            WHEN LOWER(BTRIM(COALESCE(b.site, 'cn'))) = 'intl' THEN 'intl'
            ELSE 'cn'
        END AS site,
        ROUND(GREATEST(COALESCE(b.paid_balance, 0), 0), 2) AS paid_balance,
        ROUND(GREATEST(COALESCE(b.bonus_balance, 0), 0), 2) AS bonus_balance
    FROM public.points_balance b
    INNER JOIN public.profiles p ON p.id = b.user_id
),
tracked_lots AS (
    SELECT
        l.user_id,
        CASE
            WHEN LOWER(BTRIM(COALESCE(l.site, 'cn'))) = 'intl' THEN 'intl'
            ELSE 'cn'
        END AS site,
        ROUND(COALESCE(SUM(
            CASE
                WHEN COALESCE(l.metadata ->> 'component', '') = 'paid' THEN l.points_remaining
                WHEN COALESCE(l.metadata ->> 'component', '') = 'bonus' THEN 0
                WHEN LOWER(BTRIM(COALESCE(l.source_type, 'unknown'))) IN ('recharge', 'redemption_code') THEN l.points_remaining
                WHEN LOWER(BTRIM(COALESCE(l.source_type, 'unknown'))) IN ('refund_return', 'migration')
                    AND COALESCE(l.cash_value_rate, 0) > 0 THEN l.points_remaining
                WHEN COALESCE(l.cash_value_rate, 0) > 0 THEN l.points_remaining
                ELSE 0
            END
        ), 0), 2) AS tracked_paid_remaining,
        ROUND(COALESCE(SUM(
            CASE
                WHEN COALESCE(l.metadata ->> 'component', '') = 'bonus' THEN l.points_remaining
                WHEN COALESCE(l.metadata ->> 'component', '') = 'paid' THEN 0
                WHEN LOWER(BTRIM(COALESCE(l.source_type, 'unknown'))) IN ('recharge', 'redemption_code') THEN 0
                WHEN LOWER(BTRIM(COALESCE(l.source_type, 'unknown'))) IN ('refund_return', 'migration')
                    AND COALESCE(l.cash_value_rate, 0) > 0 THEN 0
                WHEN COALESCE(l.cash_value_rate, 0) > 0 THEN 0
                ELSE l.points_remaining
            END
        ), 0), 2) AS tracked_bonus_remaining
    FROM public.wallet_point_lots l
    WHERE COALESCE(l.points_remaining, 0) > 0
    GROUP BY l.user_id, CASE
        WHEN LOWER(BTRIM(COALESCE(l.site, 'cn'))) = 'intl' THEN 'intl'
        ELSE 'cn'
    END
),
balance_gaps AS (
    SELECT
        b.user_id,
        b.site,
        b.paid_balance,
        b.bonus_balance,
        COALESCE(t.tracked_paid_remaining, 0) AS tracked_paid_remaining,
        COALESCE(t.tracked_bonus_remaining, 0) AS tracked_bonus_remaining,
        ROUND(GREATEST(b.paid_balance - COALESCE(t.tracked_paid_remaining, 0), 0), 2) AS paid_gap,
        ROUND(GREATEST(b.bonus_balance - COALESCE(t.tracked_bonus_remaining, 0), 0), 2) AS bonus_gap
    FROM normalized_balances b
    LEFT JOIN tracked_lots t
      ON t.user_id = b.user_id
     AND t.site = b.site
)
INSERT INTO public.wallet_point_lots (
    user_id,
    site,
    source_type,
    source_label,
    source_reference_id,
    points_original,
    points_remaining,
    cash_value_cny,
    cash_value_rate,
    currency,
    acquired_at,
    metadata
)
SELECT
    g.user_id,
    g.site,
    'migration',
    '迁移期赠送余额',
    'BALANCE_MIGRATION_' || g.site || '_' || g.user_id::TEXT || '_bonus',
    g.bonus_gap,
    g.bonus_gap,
    0,
    0,
    'CNY',
    NOW(),
    jsonb_build_object(
        'component', 'bonus',
        'basis', 'points_balance_remaining_backfill',
        'balance_bonus_remaining', g.bonus_balance,
        'tracked_bonus_remaining_before_backfill', g.tracked_bonus_remaining,
        'created_by_migration', '202606061830_backfill_wallet_point_lots_from_balances'
    )
FROM balance_gaps g
WHERE g.bonus_gap > 0.009
  AND NOT EXISTS (
      SELECT 1
      FROM public.wallet_point_lots existing
      WHERE existing.source_type = 'migration'
        AND existing.source_reference_id = 'BALANCE_MIGRATION_' || g.site || '_' || g.user_id::TEXT || '_bonus'
  );
