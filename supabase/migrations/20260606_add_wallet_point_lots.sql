-- Track point-source lots and order-level lot consumption.
-- This is the durable foundation for distinguishing cash-backed points from
-- bonus, activity, affiliate, refund-returned, and admin-issued points.

CREATE TABLE IF NOT EXISTS public.wallet_point_lots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    site VARCHAR(16) NOT NULL DEFAULT 'cn',
    source_type VARCHAR(40) NOT NULL,
    source_label TEXT,
    source_reference_id TEXT,
    points_original NUMERIC(14,2) NOT NULL DEFAULT 0,
    points_remaining NUMERIC(14,2) NOT NULL DEFAULT 0,
    cash_value_cny NUMERIC(14,4) NOT NULL DEFAULT 0,
    cash_value_rate NUMERIC(12,6) NOT NULL DEFAULT 0,
    currency VARCHAR(12) NOT NULL DEFAULT 'CNY',
    acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    source_ledger_id UUID REFERENCES public.points_ledger(id) ON DELETE SET NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT wallet_point_lots_source_type_check
        CHECK (source_type IN (
            'recharge',
            'redemption_code',
            'checkin',
            'activity_bonus',
            'admin_grant',
            'affiliate_commission',
            'refund_return',
            'migration',
            'unknown'
        )),
    CONSTRAINT wallet_point_lots_points_nonnegative_check
        CHECK (points_original >= 0 AND points_remaining >= 0),
    CONSTRAINT wallet_point_lots_remaining_lte_original_check
        CHECK (points_remaining <= points_original),
    CONSTRAINT wallet_point_lots_cash_nonnegative_check
        CHECK (cash_value_cny >= 0 AND cash_value_rate >= 0)
);

CREATE TABLE IF NOT EXISTS public.wallet_point_lot_consumptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    point_lot_id UUID REFERENCES public.wallet_point_lots(id) ON DELETE SET NULL,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    site VARCHAR(16) NOT NULL DEFAULT 'cn',
    order_id UUID REFERENCES public.shop_orders(id) ON DELETE CASCADE,
    order_item_id UUID REFERENCES public.shop_order_items(id) ON DELETE SET NULL,
    ledger_id UUID REFERENCES public.points_ledger(id) ON DELETE SET NULL,
    consumption_reference_id TEXT,
    points_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    cash_value_cny NUMERIC(14,4) NOT NULL DEFAULT 0,
    source_type VARCHAR(40) NOT NULL DEFAULT 'unknown',
    source_label TEXT,
    consumed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT wallet_point_lot_consumptions_points_nonnegative_check
        CHECK (points_amount >= 0),
    CONSTRAINT wallet_point_lot_consumptions_cash_nonnegative_check
        CHECK (cash_value_cny >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_point_lots_source_ledger
    ON public.wallet_point_lots (source_ledger_id)
    WHERE source_ledger_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wallet_point_lots_user_site_remaining
    ON public.wallet_point_lots (user_id, site, points_remaining DESC, acquired_at ASC)
    WHERE points_remaining > 0;

CREATE INDEX IF NOT EXISTS idx_wallet_point_lots_source_type
    ON public.wallet_point_lots (site, source_type, acquired_at DESC);

CREATE INDEX IF NOT EXISTS idx_wallet_point_lot_consumptions_order
    ON public.wallet_point_lot_consumptions (order_id, consumed_at DESC)
    WHERE order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wallet_point_lot_consumptions_lot
    ON public.wallet_point_lot_consumptions (point_lot_id, consumed_at DESC)
    WHERE point_lot_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wallet_point_lot_consumptions_user_site
    ON public.wallet_point_lot_consumptions (user_id, site, consumed_at DESC);

COMMENT ON TABLE public.wallet_point_lots IS
    'Point-source lots used to distinguish cash-backed paid points from bonus/activity/affiliate/refund/admin points.';
COMMENT ON COLUMN public.wallet_point_lots.cash_value_rate IS
    'Cash value per point in CNY. Recharge lots are usually 1; bonus/activity lots are usually 0 unless configured otherwise.';
COMMENT ON TABLE public.wallet_point_lot_consumptions IS
    'Order-level consumption rows that explain which point lots funded a shop order.';
COMMENT ON COLUMN public.wallet_point_lot_consumptions.cash_value_cny IS
    'Cash-backed value consumed by this order from the source lot. This drives true revenue attribution.';

ALTER TABLE public.wallet_point_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_point_lot_consumptions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'wallet_point_lots'
          AND policyname = 'Admins manage wallet point lots'
    ) THEN
        CREATE POLICY "Admins manage wallet point lots"
            ON public.wallet_point_lots
            FOR ALL
            USING (public.is_admin())
            WITH CHECK (public.is_admin());
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'wallet_point_lot_consumptions'
          AND policyname = 'Admins manage wallet point lot consumptions'
    ) THEN
        CREATE POLICY "Admins manage wallet point lot consumptions"
            ON public.wallet_point_lot_consumptions
            FOR ALL
            USING (public.is_admin())
            WITH CHECK (public.is_admin());
    END IF;
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wallet_point_lots TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wallet_point_lot_consumptions TO authenticated;
