-- Restore the guest-shop manual-review refund guard.
-- Apply this after 20260928_guest_shop_promo_return_by_redemption_date.sql.
--
-- 20260923_guest_shop_refund_state_hardening.sql created
-- guest_shop_preserve_refund_manual_review() and its BEFORE UPDATE OF
-- refund_status trigger. 20260928 replaced the refund function and does not
-- recreate this guard. Do not rerun
-- 20260923_guest_shop_refund_state_hardening.sql or
-- 20260928_guest_shop_promo_return_by_redemption_date.sql: replaying the
-- older refund migration would overwrite the newer refund function.
--
-- This file only restores the guard. It does not change order rows, the promo
-- ledger, or the daily budget. It does not enable guest products, promotion,
-- flash sales, tier pricing, or INTL payments.
-- Codex does not execute this file; the operator applies it in the target DB.
BEGIN;

CREATE OR REPLACE FUNCTION public.guest_shop_preserve_refund_manual_review()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF OLD.refund_status = 'manual_review'
       AND NEW.refund_status = 'pending' THEN
        NEW.refund_status := 'manual_review';
    END IF;
    RETURN NEW;
END;
$$;

-- REVOKE then GRANT leaves a non-default ACL: browser roles cannot execute
-- this trigger function, and service_role can. Leaving the default PUBLIC
-- execute grant would fail the promo privilege probe.
REVOKE ALL ON FUNCTION public.guest_shop_preserve_refund_manual_review()
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_shop_preserve_refund_manual_review()
    TO service_role;

DROP TRIGGER IF EXISTS guest_shop_preserve_refund_manual_review
    ON public.guest_shop_orders;
CREATE TRIGGER guest_shop_preserve_refund_manual_review
    BEFORE UPDATE OF refund_status ON public.guest_shop_orders
    FOR EACH ROW
    EXECUTE FUNCTION public.guest_shop_preserve_refund_manual_review();

COMMIT;
