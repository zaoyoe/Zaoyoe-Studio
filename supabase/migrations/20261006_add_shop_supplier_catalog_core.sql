-- Provider-neutral foundation for importing and preflighting externally fulfilled
-- shop products. This migration intentionally does not enable any product and
-- does not modify existing payment or fulfillment paths.

CREATE TABLE IF NOT EXISTS public.shop_supplier_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id TEXT NOT NULL,
    account_key TEXT NOT NULL,
    display_name TEXT NOT NULL,
    credential_ref TEXT NOT NULL,
    is_enabled BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT shop_supplier_accounts_provider_id_check
        CHECK (provider_id = LOWER(BTRIM(provider_id)) AND provider_id ~ '^[a-z0-9][a-z0-9._-]*$'),
    CONSTRAINT shop_supplier_accounts_account_key_check
        CHECK (account_key = LOWER(BTRIM(account_key)) AND account_key ~ '^[a-z0-9][a-z0-9._-]*$'),
    CONSTRAINT shop_supplier_accounts_credential_ref_check
        CHECK (BTRIM(credential_ref) <> ''),
    CONSTRAINT shop_supplier_accounts_provider_account_unique
        UNIQUE (provider_id, account_key)
);

-- A disabled-by-default account row gives the admin catalog importer a stable
-- provider/account identity. Actual credentials remain in server environment
-- configuration and are never written to this row.
INSERT INTO public.shop_supplier_accounts (provider_id, account_key, display_name, credential_ref, is_enabled)
VALUES ('16688', 'default', '16688 默认账号', 'env:SUPPLIER_16688', false)
ON CONFLICT (provider_id, account_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.shop_supplier_product_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site VARCHAR(16) NOT NULL DEFAULT 'cn',
    supplier_account_id UUID NOT NULL
        REFERENCES public.shop_supplier_accounts(id) ON DELETE RESTRICT,
    product_id UUID NOT NULL
        REFERENCES public.shop_products(id) ON DELETE CASCADE,
    sku_id UUID
        REFERENCES public.shop_product_skus(id) ON DELETE CASCADE,
    supplier_goods_no TEXT NOT NULL,
    priority INT NOT NULL DEFAULT 100,
    is_primary BOOLEAN NOT NULL DEFAULT false,
    is_enabled BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT shop_supplier_product_mappings_site_check
        CHECK (site IN ('cn', 'intl')),
    CONSTRAINT shop_supplier_product_mappings_goods_no_check
        CHECK (BTRIM(supplier_goods_no) <> ''),
    CONSTRAINT shop_supplier_product_mappings_priority_check
        CHECK (priority >= 0),
    CONSTRAINT shop_supplier_product_mappings_account_goods_unique
        UNIQUE (supplier_account_id, site, supplier_goods_no)
);

CREATE INDEX IF NOT EXISTS idx_shop_supplier_product_mappings_product
    ON public.shop_supplier_product_mappings (site, product_id, sku_id, is_enabled, priority);

CREATE UNIQUE INDEX IF NOT EXISTS ux_shop_supplier_product_mappings_primary_target
    ON public.shop_supplier_product_mappings (
        site,
        product_id,
        COALESCE(sku_id, '00000000-0000-0000-0000-000000000000'::UUID)
    )
    WHERE is_enabled = true AND is_primary = true;

CREATE TABLE IF NOT EXISTS public.shop_supplier_availability (
    mapping_id UUID PRIMARY KEY
        REFERENCES public.shop_supplier_product_mappings(id) ON DELETE CASCADE,
    availability_status TEXT NOT NULL DEFAULT 'unknown',
    available_quantity INT,
    delivery_method SMALLINT,
    minimum_quantity INT,
    supplier_unit_price NUMERIC(18, 6),
    currency VARCHAR(12) NOT NULL DEFAULT 'CNY',
    balance_enough BOOLEAN,
    checked_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    last_error_code TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT shop_supplier_availability_status_check
        CHECK (availability_status IN ('available', 'unavailable', 'unknown')),
    CONSTRAINT shop_supplier_availability_quantity_check
        CHECK (available_quantity IS NULL OR available_quantity >= 0),
    CONSTRAINT shop_supplier_availability_delivery_check
        CHECK (delivery_method IS NULL OR delivery_method IN (1, 2, 3)),
    CONSTRAINT shop_supplier_availability_min_quantity_check
        CHECK (minimum_quantity IS NULL OR minimum_quantity >= 1),
    CONSTRAINT shop_supplier_availability_unit_price_check
        CHECK (supplier_unit_price IS NULL OR supplier_unit_price >= 0),
    CONSTRAINT shop_supplier_availability_currency_check
        CHECK (currency = UPPER(BTRIM(currency)) AND currency ~ '^[A-Z0-9]{3,12}$')
);

CREATE INDEX IF NOT EXISTS idx_shop_supplier_availability_expiry
    ON public.shop_supplier_availability (availability_status, expires_at);

ALTER TABLE public.shop_supplier_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_supplier_product_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_supplier_availability ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.shop_supplier_accounts FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.shop_supplier_product_mappings FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.shop_supplier_availability FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.shop_supplier_accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.shop_supplier_product_mappings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.shop_supplier_availability TO authenticated;
GRANT ALL ON TABLE public.shop_supplier_accounts TO service_role;
GRANT ALL ON TABLE public.shop_supplier_product_mappings TO service_role;
GRANT ALL ON TABLE public.shop_supplier_availability TO service_role;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'shop_supplier_accounts'
          AND policyname = 'Admins manage shop supplier accounts'
    ) THEN
        CREATE POLICY "Admins manage shop supplier accounts"
            ON public.shop_supplier_accounts
            FOR ALL
            TO authenticated
            USING (public.is_admin())
            WITH CHECK (public.is_admin());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'shop_supplier_product_mappings'
          AND policyname = 'Admins manage shop supplier product mappings'
    ) THEN
        CREATE POLICY "Admins manage shop supplier product mappings"
            ON public.shop_supplier_product_mappings
            FOR ALL
            TO authenticated
            USING (public.is_admin())
            WITH CHECK (public.is_admin());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'shop_supplier_availability'
          AND policyname = 'Admins manage shop supplier availability'
    ) THEN
        CREATE POLICY "Admins manage shop supplier availability"
            ON public.shop_supplier_availability
            FOR ALL
            TO authenticated
            USING (public.is_admin())
            WITH CHECK (public.is_admin());
    END IF;
END;
$$;

COMMENT ON TABLE public.shop_supplier_accounts IS
    'Provider-neutral upstream supplier accounts. credential_ref is a secret-store reference, never a credential value.';
COMMENT ON TABLE public.shop_supplier_product_mappings IS
    'Maps a storefront product/SKU to one upstream provider account and goods identifier; disabled by default.';
COMMENT ON TABLE public.shop_supplier_availability IS
    'Private, expiring upstream availability and quote snapshot. Never expose this table directly to storefront clients.';
COMMENT ON COLUMN public.shop_supplier_availability.balance_enough IS
    'Private last-quote boolean only; exact upstream wallet balances must not be stored or exposed here.';
