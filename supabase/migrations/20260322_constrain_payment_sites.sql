-- ============================================
-- Constrain Payment Site Values
-- 支付相关表统一只允许 cn / intl，避免未知 site 混入支付链路
-- ============================================

UPDATE public.payment_checkout_sessions
SET site = LOWER(BTRIM(COALESCE(site, '')))
WHERE site IS DISTINCT FROM LOWER(BTRIM(COALESCE(site, '')));

UPDATE public.payment_checkout_sessions
SET site = 'cn'
WHERE site IS NULL OR BTRIM(site) = '';

UPDATE public.payment_orders
SET site = LOWER(BTRIM(COALESCE(site, '')))
WHERE site IS DISTINCT FROM LOWER(BTRIM(COALESCE(site, '')));

UPDATE public.payment_orders
SET site = 'cn'
WHERE site IS NULL OR BTRIM(site) = '';

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.payment_checkout_sessions
        WHERE site NOT IN ('cn', 'intl')
    ) THEN
        RAISE EXCEPTION 'payment_checkout_sessions contains unsupported site values';
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.payment_orders
        WHERE site NOT IN ('cn', 'intl')
    ) THEN
        RAISE EXCEPTION 'payment_orders contains unsupported site values';
    END IF;
END $$;

ALTER TABLE public.payment_checkout_sessions
    DROP CONSTRAINT IF EXISTS payment_checkout_sessions_site_check;

ALTER TABLE public.payment_checkout_sessions
    ADD CONSTRAINT payment_checkout_sessions_site_check
    CHECK (site IN ('cn', 'intl'));

ALTER TABLE public.payment_orders
    DROP CONSTRAINT IF EXISTS payment_orders_site_check;

ALTER TABLE public.payment_orders
    ADD CONSTRAINT payment_orders_site_check
    CHECK (site IN ('cn', 'intl'));
