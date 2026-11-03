-- Supplier-focused isolated baseline bootstrap for the application checkout.
--
-- This is intentionally not a production schema dump. It creates only the
-- Supabase-compatible foundation required to replay the supplier catalog/SKU
-- migrations in a fresh local PostgreSQL 17.6 database. It contains no
-- business rows, supplier credentials, inventory, orders, or enabled products.
--
-- Apply this file only to a newly-created local acceptance database.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- The Supabase PostgreSQL image already provides auth.users. Keep the local
-- profile shape compatible with the supplier/admin functions without copying
-- any production users.
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT,
    username TEXT,
    avatar_url TEXT,
    updated_at TIMESTAMPTZ
);

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
    SELECT COALESCE(auth.role() = 'service_role', false);
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
    SELECT COALESCE(auth.role() = 'service_role', false);
$$;

CREATE TABLE IF NOT EXISTS public.shop_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    icon_url VARCHAR(255),
    image_assets JSONB NOT NULL DEFAULT '{}'::JSONB,
    price_points NUMERIC(12,2) NOT NULL DEFAULT 0,
    price_points_intl NUMERIC(12,2),
    category VARCHAR(50) NOT NULL DEFAULT 'resource',
    tags JSONB NOT NULL DEFAULT '[]'::JSONB,
    display_order INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT false,
    allow_guest_purchase BOOLEAN NOT NULL DEFAULT false,
    stock_count INT NOT NULL DEFAULT 0,
    quantity_rules JSONB,
    quantity_rules_intl JSONB,
    flash_sale_end TIMESTAMPTZ,
    flash_sale_end_intl TIMESTAMPTZ,
    flash_sale_price NUMERIC(12,2),
    flash_sale_price_intl NUMERIC(12,2),
    delivery_type VARCHAR(20) NOT NULL DEFAULT 'KEY',
    webhook_target TEXT,
    usage_instructions TEXT,
    show_usage_instructions BOOLEAN NOT NULL DEFAULT false,
    max_purchase_quantity INT,
    purchase_limit_24h_quantity INT,
    purchase_limit_window_minutes INT,
    purchase_limit_window_quantity INT,
    per_account_purchase_limit INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.shop_inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID REFERENCES public.shop_products(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'available',
    batch_id VARCHAR(50),
    buyer_id UUID REFERENCES auth.users(id),
    sold_at TIMESTAMPTZ,
    remark TEXT,
    sku_id UUID,
    source_batch_id UUID,
    purchase_unit_cost NUMERIC(14,4),
    purchase_currency VARCHAR(12),
    purchase_exchange_rate_to_cny NUMERIC(18,8),
    purchase_unit_cost_cny NUMERIC(14,4),
    is_shared BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.shop_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id),
    product_id UUID REFERENCES public.shop_products(id),
    sku_id UUID,
    inventory_id UUID REFERENCES public.shop_inventory(id),
    price_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_price NUMERIC(12,2),
    item_count INT NOT NULL DEFAULT 1,
    snapshot_product_name VARCHAR(100),
    email_sent BOOLEAN NOT NULL DEFAULT false,
    refund_status VARCHAR(20) NOT NULL DEFAULT 'none',
    discount_code VARCHAR(50),
    discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    discount_asset_id UUID,
    discount_asset_restored BOOLEAN NOT NULL DEFAULT false,
    discount_snapshot JSONB,
    discount_version INT,
    discount_usage_restored BOOLEAN NOT NULL DEFAULT false,
    discount_refund_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    delivery_status TEXT NOT NULL DEFAULT 'pending',
    delivery_completed_at TIMESTAMPTZ,
    delivery_updated_at TIMESTAMPTZ,
    delivery_attempt_count INT NOT NULL DEFAULT 0,
    delivery_task_id UUID,
    site VARCHAR(16) NOT NULL DEFAULT 'cn',
    source_channel TEXT,
    channel_account_key TEXT,
    external_order_id TEXT,
    external_order_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.shop_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES public.shop_orders(id) ON DELETE CASCADE,
    inventory_id UUID REFERENCES public.shop_inventory(id) ON DELETE SET NULL,
    sku_id UUID,
    snapshot_product_name VARCHAR(100),
    price_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.shop_webhook_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES public.shop_orders(id) ON DELETE CASCADE,
    target_url TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::JSONB,
    status TEXT NOT NULL DEFAULT 'pending',
    attempt_count INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 5,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    dedupe_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    target_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    action_type TEXT NOT NULL,
    details JSONB DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- These tables are referenced by the existing SKU/purchase function bodies.
-- They remain empty in this baseline; no payment or purchase path is enabled.
CREATE TABLE IF NOT EXISTS public.discount_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) NOT NULL,
    discount_type VARCHAR(20) NOT NULL DEFAULT 'percent',
    discount_value INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT false,
    expires_at TIMESTAMPTZ,
    max_uses INT NOT NULL DEFAULT 0,
    used_count INT NOT NULL DEFAULT 0,
    version_no INT NOT NULL DEFAULT 1,
    applicable_site VARCHAR(16) DEFAULT 'cn',
    scope_type VARCHAR(32),
    scope_category VARCHAR(50),
    scope_product_id UUID,
    max_uses_per_user INT,
    starts_at TIMESTAMPTZ,
    allow_zero_total BOOLEAN NOT NULL DEFAULT false,
    lifecycle_status VARCHAR(32),
    status_reason TEXT,
    recovery_strategy VARCHAR(32),
    observation_ends_at TIMESTAMPTZ,
    campaign_tag TEXT,
    audience_segment TEXT,
    distribution_mode TEXT,
    is_exclusive BOOLEAN NOT NULL DEFAULT false,
    stack_priority INT,
    pricing_apply_stage TEXT
);

CREATE TABLE IF NOT EXISTS public.discount_user_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    discount_id UUID,
    source_type TEXT,
    source_channel TEXT,
    asset_status TEXT,
    audience_segment TEXT,
    expires_at TIMESTAMPTZ,
    used_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.points_balance (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    total_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
    bonus_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
    paid_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.points_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id),
    amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    balance_snapshot NUMERIC(12,2),
    type TEXT,
    reason TEXT,
    reference_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_purchase_entitlements (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    unlimited_shop_purchases BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.agent_prices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID,
    product_id UUID,
    sku_id UUID,
    price NUMERIC(12,2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.shop_purchase_reward_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.fn_resolve_shop_percent_discount(
    p_subtotal NUMERIC,
    p_discount_value INT,
    p_allow_zero_total BOOLEAN DEFAULT false
)
RETURNS TABLE (
    discount_amount NUMERIC(12,2),
    final_total NUMERIC(12,2),
    has_effective_discount BOOLEAN
)
LANGUAGE SQL
IMMUTABLE
AS $$
    SELECT
        ROUND(GREATEST(0, COALESCE(p_subtotal, 0)) * GREATEST(0, LEAST(100, COALESCE(p_discount_value, 0))) / 100, 2),
        ROUND(GREATEST(0, COALESCE(p_subtotal, 0)) * (100 - GREATEST(0, LEAST(100, COALESCE(p_discount_value, 0)))) / 100, 2),
        (COALESCE(p_subtotal, 0) > 0 AND COALESCE(p_discount_value, 0) > 0);
$$;

ALTER TABLE public.shop_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_shop_inventory_status
    ON public.shop_inventory (product_id, status);
CREATE INDEX IF NOT EXISTS idx_shop_orders_user
    ON public.shop_orders (user_id);

COMMIT;
