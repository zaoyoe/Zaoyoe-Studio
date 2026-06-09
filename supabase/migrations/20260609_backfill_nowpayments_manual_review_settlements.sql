-- Backfill NOWPayments orders that were manually approved before the admin
-- review path settled wallet points. Safe to re-run: orders with the expected
-- positive points_ledger reference are skipped.

WITH candidate_orders AS (
    SELECT
        po.id,
        po.user_id,
        CASE
            WHEN LOWER(BTRIM(COALESCE(po.site, 'cn'))) = 'intl' THEN 'intl'
            ELSE 'cn'
        END AS site,
        BTRIM(COALESCE(po.provider_order_no, '')) AS provider_order_no,
        COALESCE(po.provider_metadata, '{}'::JSONB) AS provider_metadata,
        ROUND(GREATEST(COALESCE(po.points_amount, 0), 0), 2) AS fallback_points,
        CASE
            WHEN LOWER(BTRIM(COALESCE(po.provider_metadata ->> 'charge_type', ''))) = 'custom' THEN 'custom_recharge'
            ELSE 'USDT-BEP20充值: ' || COALESCE(NULLIF(BTRIM(po.package_name), ''), NULLIF(BTRIM(po.provider_order_no), ''), '充值订单')
        END AS reason,
        'nowpayments_' || BTRIM(COALESCE(po.provider_order_no, '')) AS reference_id
    FROM public.payment_orders po
    WHERE LOWER(BTRIM(COALESCE(po.provider, ''))) = 'nowpayments'
      AND LOWER(BTRIM(COALESCE(po.status, ''))) IN ('paid', 'redeemed')
      AND po.user_id IS NOT NULL
      AND BTRIM(COALESCE(po.provider_order_no, '')) <> ''
      AND ROUND(GREATEST(COALESCE(po.points_amount, 0), 0), 2) > 0
),
point_breakdown AS (
    SELECT
        co.*,
        CASE
            WHEN COALESCE(co.provider_metadata ->> 'paid_points', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
                THEN ROUND(GREATEST((co.provider_metadata ->> 'paid_points')::NUMERIC, 0), 2)
            ELSE NULL
        END AS raw_paid_points,
        CASE
            WHEN COALESCE(co.provider_metadata ->> 'bonus_points', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
                THEN ROUND(GREATEST((co.provider_metadata ->> 'bonus_points')::NUMERIC, 0), 2)
            ELSE NULL
        END AS raw_bonus_points
    FROM candidate_orders co
),
eligible_orders AS (
    SELECT
        pb.*,
        CASE
            WHEN pb.raw_paid_points IS NOT NULL OR pb.raw_bonus_points IS NOT NULL
                THEN ROUND(GREATEST(COALESCE(pb.raw_paid_points, 0), 0), 2)
            ELSE pb.fallback_points
        END AS paid_points,
        CASE
            WHEN pb.raw_paid_points IS NOT NULL OR pb.raw_bonus_points IS NOT NULL
                THEN ROUND(GREATEST(COALESCE(pb.raw_bonus_points, 0), 0), 2)
            ELSE 0
        END AS bonus_points
    FROM point_breakdown pb
    WHERE NOT EXISTS (
        SELECT 1
        FROM public.points_ledger pl
        WHERE pl.user_id = pb.user_id
          AND COALESCE(NULLIF(BTRIM(pl.site), ''), 'cn') = pb.site
          AND pl.reference_id = pb.reference_id
          AND COALESCE(pl.amount, 0) > 0
    )
),
inserted_ledger AS (
    INSERT INTO public.points_ledger (user_id, amount, reason, reference_id, site)
    SELECT
        eo.user_id,
        ROUND(eo.paid_points + eo.bonus_points, 2),
        eo.reason,
        eo.reference_id,
        eo.site
    FROM eligible_orders eo
    WHERE ROUND(eo.paid_points + eo.bonus_points, 2) > 0
    RETURNING id, user_id, amount, reason, reference_id, site
),
updated_balances AS (
    INSERT INTO public.points_balance (user_id, site, paid_balance, bonus_balance)
    SELECT
        eo.user_id,
        eo.site,
        eo.paid_points,
        eo.bonus_points
    FROM eligible_orders eo
    INNER JOIN inserted_ledger il
        ON il.user_id = eo.user_id
       AND il.reference_id = eo.reference_id
       AND il.site = eo.site
    ON CONFLICT (user_id, site)
    DO UPDATE SET
        paid_balance = ROUND(public.points_balance.paid_balance + EXCLUDED.paid_balance, 2),
        bonus_balance = ROUND(public.points_balance.bonus_balance + EXCLUDED.bonus_balance, 2),
        updated_at = NOW()
    RETURNING user_id, site
),
inserted_paid_lots AS (
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
        source_ledger_id,
        metadata
    )
    SELECT
        eo.user_id,
        eo.site,
        'recharge',
        eo.reason,
        eo.reference_id,
        eo.paid_points,
        eo.paid_points,
        eo.paid_points,
        CASE WHEN eo.paid_points > 0 THEN 1 ELSE 0 END,
        'CNY',
        il.id,
        jsonb_build_object(
            'component', 'paid',
            'created_by_migration', '20260609_backfill_nowpayments_manual_review_settlements'
        )
    FROM eligible_orders eo
    INNER JOIN inserted_ledger il
        ON il.user_id = eo.user_id
       AND il.reference_id = eo.reference_id
       AND il.site = eo.site
    WHERE eo.paid_points > 0
    ON CONFLICT (source_ledger_id)
    WHERE source_ledger_id IS NOT NULL
    DO UPDATE SET
        source_type = EXCLUDED.source_type,
        source_label = EXCLUDED.source_label,
        source_reference_id = EXCLUDED.source_reference_id,
        points_original = EXCLUDED.points_original,
        points_remaining = GREATEST(public.wallet_point_lots.points_remaining, EXCLUDED.points_remaining),
        cash_value_cny = EXCLUDED.cash_value_cny,
        cash_value_rate = EXCLUDED.cash_value_rate,
        currency = EXCLUDED.currency,
        metadata = public.wallet_point_lots.metadata || EXCLUDED.metadata,
        updated_at = NOW()
    RETURNING id
),
inserted_bonus_lots AS (
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
        source_ledger_id,
        metadata
    )
    SELECT
        eo.user_id,
        eo.site,
        'activity_bonus',
        eo.reason,
        eo.reference_id,
        eo.bonus_points,
        eo.bonus_points,
        0,
        0,
        'CNY',
        NULL,
        jsonb_build_object(
            'component', 'bonus',
            'source_ledger_id', il.id,
            'created_by_migration', '20260609_backfill_nowpayments_manual_review_settlements'
        )
    FROM eligible_orders eo
    INNER JOIN inserted_ledger il
        ON il.user_id = eo.user_id
       AND il.reference_id = eo.reference_id
       AND il.site = eo.site
    WHERE eo.bonus_points > 0
    RETURNING id
),
updated_orders AS (
    UPDATE public.payment_orders po
    SET
        status = 'redeemed',
        sign_verified = TRUE,
        amount_verified = TRUE,
        paid_at = COALESCE(po.paid_at, NOW()),
        verified_at = COALESCE(po.verified_at, NOW()),
        claimed_at = COALESCE(po.claimed_at, NOW()),
        last_error = NULL,
        provider_metadata = COALESCE(po.provider_metadata, '{}'::JSONB) || jsonb_build_object(
            'admin_review_settlement_backfilled_at', NOW(),
            'admin_review_settlement_reference_id', eo.reference_id,
            'admin_review_settlement_source', '20260609_backfill_nowpayments_manual_review_settlements'
        ),
        updated_at = NOW()
    FROM eligible_orders eo
    INNER JOIN inserted_ledger il
        ON il.user_id = eo.user_id
       AND il.reference_id = eo.reference_id
       AND il.site = eo.site
    WHERE po.id = eo.id
    RETURNING po.id
)
SELECT
    (SELECT COUNT(*) FROM inserted_ledger) AS inserted_ledger_count,
    (SELECT COUNT(*) FROM updated_balances) AS updated_balance_count,
    (SELECT COUNT(*) FROM inserted_paid_lots) AS inserted_paid_lot_count,
    (SELECT COUNT(*) FROM inserted_bonus_lots) AS inserted_bonus_lot_count,
    (SELECT COUNT(*) FROM updated_orders) AS updated_order_count;
