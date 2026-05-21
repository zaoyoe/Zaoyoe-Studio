-- Marketplace order attribution for shared inventory channels.
-- 网站订单继续默认归到 website，闲鱼/其它渠道适配器可以写入外部订单号和账号键。

ALTER TABLE IF EXISTS public.shop_orders
    ADD COLUMN IF NOT EXISTS source_channel TEXT NOT NULL DEFAULT 'website',
    ADD COLUMN IF NOT EXISTS channel_account_key TEXT NOT NULL DEFAULT 'main',
    ADD COLUMN IF NOT EXISTS external_order_id TEXT,
    ADD COLUMN IF NOT EXISTS external_order_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.shop_orders
SET
    source_channel = COALESCE(NULLIF(LOWER(BTRIM(source_channel)), ''), 'website'),
    channel_account_key = COALESCE(NULLIF(LOWER(BTRIM(channel_account_key)), ''), 'main'),
    external_order_snapshot = COALESCE(external_order_snapshot, '{}'::jsonb)
WHERE COALESCE(NULLIF(BTRIM(source_channel), ''), '') = ''
   OR COALESCE(NULLIF(BTRIM(channel_account_key), ''), '') = ''
   OR external_order_snapshot IS NULL;

ALTER TABLE IF EXISTS public.shop_orders
    DROP CONSTRAINT IF EXISTS shop_orders_source_channel_check,
    DROP CONSTRAINT IF EXISTS shop_orders_channel_account_key_check;

ALTER TABLE IF EXISTS public.shop_orders
    ADD CONSTRAINT shop_orders_source_channel_check
    CHECK (source_channel ~ '^[a-z0-9_-]{1,80}$'),
    ADD CONSTRAINT shop_orders_channel_account_key_check
    CHECK (channel_account_key ~ '^[a-z0-9_-]{1,80}$');

CREATE INDEX IF NOT EXISTS idx_shop_orders_source_channel_created_at
    ON public.shop_orders (source_channel, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shop_orders_source_account_created_at
    ON public.shop_orders (source_channel, channel_account_key, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shop_orders_external_order_unique
    ON public.shop_orders (source_channel, channel_account_key, external_order_id)
    WHERE external_order_id IS NOT NULL
      AND NULLIF(BTRIM(external_order_id), '') IS NOT NULL;

COMMENT ON COLUMN public.shop_orders.source_channel IS 'Marketplace/source channel for shared inventory orders, e.g. website or xianyu.';
COMMENT ON COLUMN public.shop_orders.channel_account_key IS 'Channel account key such as main, backup-1, or a xianyu account alias.';
COMMENT ON COLUMN public.shop_orders.external_order_id IS 'External marketplace order id for de-duplication and admin lookup.';
COMMENT ON COLUMN public.shop_orders.external_order_snapshot IS 'Raw or normalized external marketplace order payload captured by the channel adapter.';
