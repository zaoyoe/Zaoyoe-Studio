-- Create the persistent shop order profit ledger.
-- The application can already build a deterministic preview from order
-- attribution; this table is the durable target for replay, settlement, and
-- historical backfills.

CREATE TABLE IF NOT EXISTS public.shop_order_profit_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site VARCHAR(16) NOT NULL DEFAULT 'cn',
    order_id UUID NOT NULL REFERENCES public.shop_orders(id) ON DELETE CASCADE,
    order_item_id UUID REFERENCES public.shop_order_items(id) ON DELETE SET NULL,
    inventory_id UUID REFERENCES public.shop_inventory(id) ON DELETE SET NULL,
    source_batch_id UUID REFERENCES public.shop_procurement_batches(id) ON DELETE SET NULL,
    dedupe_key TEXT NOT NULL,
    entry_type VARCHAR(64) NOT NULL,
    entry_group VARCHAR(32) NOT NULL DEFAULT 'adjustment',
    direction VARCHAR(16) NOT NULL DEFAULT 'neutral',
    amount NUMERIC(14,4) NOT NULL DEFAULT 0,
    currency VARCHAR(12) NOT NULL DEFAULT 'CNY',
    cash_value_cny NUMERIC(14,4) NOT NULL DEFAULT 0,
    points_amount NUMERIC(14,2),
    status VARCHAR(32) NOT NULL DEFAULT 'estimated',
    confidence VARCHAR(32) NOT NULL DEFAULT 'exact',
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    settled_at TIMESTAMPTZ,
    created_by UUID,
    snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT shop_order_profit_ledger_group_check
        CHECK (entry_group IN ('revenue', 'cost', 'adjustment', 'reversal', 'fee', 'commission', 'manual')),
    CONSTRAINT shop_order_profit_ledger_direction_check
        CHECK (direction IN ('debit', 'credit', 'neutral')),
    CONSTRAINT shop_order_profit_ledger_status_check
        CHECK (status IN ('draft', 'estimated', 'settled', 'reversed', 'reversed_estimated', 'excluded', 'incomplete', 'void')),
    CONSTRAINT shop_order_profit_ledger_confidence_check
        CHECK (confidence IN ('exact', 'partial', 'estimated', 'missing', 'none')),
    CONSTRAINT shop_order_profit_ledger_type_check
        CHECK (entry_type IN (
            'revenue_points_paid',
            'revenue_points_untracked',
            'revenue_points_bonus',
            'inventory_cost',
            'inventory_cost_missing',
            'coupon_cost',
            'affiliate_commission',
            'payment_fee',
            'refund_reversal',
            'inventory_cost_reversal',
            'manual_adjustment',
            'fulfillment_cost',
            'api_cost'
        ))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shop_order_profit_ledger_order_dedupe
    ON public.shop_order_profit_ledger (order_id, dedupe_key);

CREATE INDEX IF NOT EXISTS idx_shop_order_profit_ledger_site_occurred
    ON public.shop_order_profit_ledger (site, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_shop_order_profit_ledger_order
    ON public.shop_order_profit_ledger (order_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_shop_order_profit_ledger_inventory
    ON public.shop_order_profit_ledger (inventory_id)
    WHERE inventory_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shop_order_profit_ledger_source_batch
    ON public.shop_order_profit_ledger (source_batch_id, occurred_at DESC)
    WHERE source_batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shop_order_profit_ledger_type_status
    ON public.shop_order_profit_ledger (entry_type, status, occurred_at DESC);

COMMENT ON TABLE public.shop_order_profit_ledger IS
    'Durable profit ledger for shop orders. Amount is signed; positive entries add profit, negative entries reduce profit.';
COMMENT ON COLUMN public.shop_order_profit_ledger.dedupe_key IS
    'Stable application-generated key for idempotent ledger upserts per order.';
COMMENT ON COLUMN public.shop_order_profit_ledger.entry_type IS
    'Revenue, cost, coupon, refund, commission, fee, or manual adjustment type.';
COMMENT ON COLUMN public.shop_order_profit_ledger.entry_group IS
    'High-level accounting group used by admin reconciliation views.';
COMMENT ON COLUMN public.shop_order_profit_ledger.amount IS
    'Signed amount in currency. Positive increases profit; negative decreases profit.';
COMMENT ON COLUMN public.shop_order_profit_ledger.cash_value_cny IS
    'Signed CNY value used by net-profit reconciliation.';
COMMENT ON COLUMN public.shop_order_profit_ledger.points_amount IS
    'Related point amount when the ledger entry originated from point spending or refunds.';
COMMENT ON COLUMN public.shop_order_profit_ledger.snapshot IS
    'Immutable source snapshot used to explain how this ledger entry was produced.';

ALTER TABLE public.shop_order_profit_ledger ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'shop_order_profit_ledger'
          AND policyname = 'Admins manage shop order profit ledger'
    ) THEN
        CREATE POLICY "Admins manage shop order profit ledger"
            ON public.shop_order_profit_ledger
            FOR ALL
            USING (public.is_admin())
            WITH CHECK (public.is_admin());
    END IF;
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shop_order_profit_ledger TO authenticated;
