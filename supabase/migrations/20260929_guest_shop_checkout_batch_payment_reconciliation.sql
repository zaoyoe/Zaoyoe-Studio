-- Run manually in the SQL editor. This changes functions/triggers only; it does
-- not declare any order paid, deliver cards, or release inventory.
BEGIN;

-- payment_status is both a table column and a RETURNS TABLE variable.
DO $patch$
DECLARE
    v_definition TEXT;
    v_patched TEXT;
BEGIN
    v_definition := pg_get_functiondef(
        'public.fn_guest_shop_confirm_checkout_batch_payment(uuid,text,text,numeric,text)'::REGPROCEDURE
    );
    IF v_definition !~ 'guest_shop_checkout_batches[.]payment_status[[:space:]]*<>[[:space:]]*''confirmed''' THEN
        v_patched := regexp_replace(v_definition,
            'WHERE[[:space:]]+id[[:space:]]*=[[:space:]]*v_batch[.]id[[:space:]]+AND[[:space:]]+payment_status[[:space:]]*<>[[:space:]]*''confirmed'';',
            'WHERE guest_shop_checkout_batches.id = v_batch.id AND guest_shop_checkout_batches.payment_status <> ''confirmed'';');
        IF v_patched = v_definition THEN
            RAISE EXCEPTION 'guest_checkout_batch_confirmation_patch_target_not_found';
        END IF;
        EXECUTE v_patched;
    END IF;
    v_definition := pg_get_functiondef(
        'public.fn_guest_shop_confirm_checkout_batch_payment(uuid,text,text,numeric,text)'::REGPROCEDURE
    );
    IF v_definition !~ 'guest_shop_checkout_batches[.]payment_status[[:space:]]*<>[[:space:]]*''confirmed''' THEN
        RAISE EXCEPTION 'guest_checkout_batch_confirmation_patch_verification_failed';
    END IF;
END;
$patch$;

CREATE OR REPLACE FUNCTION public.guest_shop_checkout_batch_has_verified_payment(p_batch_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $evidence$
    SELECT EXISTS (
        SELECT 1 FROM public.guest_shop_checkout_payments p
        JOIN public.guest_shop_payment_events e
          ON e.merchant_order_no = p.merchant_order_no AND e.provider = p.provider
        WHERE p.batch_id = p_batch_id
          AND e.signature_verified AND e.amount_verified AND e.currency_verified AND e.final_status_verified
          AND e.observed_status IN ('paid', 'confirmed', 'complete', 'completed', 'success')
          AND e.observed_amount = p.expected_amount
          AND e.observed_currency = p.currency AND e.observed_site = p.site
          AND e.observed_purpose = 'shop_direct'
          AND e.provider_order_no IS NOT NULL
          AND (p.provider_order_no IS NULL OR e.provider_order_no = p.provider_order_no)
    );
$evidence$;

-- A verified observation is durable before the confirmation RPC is attempted.
-- Lock in the same order as confirmation/cancellation/expiry. If confirmation
-- fails, expiry must not sell the buyer's reserved cards to someone else.
CREATE OR REPLACE FUNCTION public.guest_shop_hold_verified_checkout_batch()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $hold$
DECLARE
    v_payment public.guest_shop_checkout_payments%ROWTYPE;
    v_batch public.guest_shop_checkout_batches%ROWTYPE;
BEGIN
    IF NOT COALESCE(
        NEW.signature_verified AND NEW.amount_verified AND NEW.currency_verified AND NEW.final_status_verified
        AND NEW.observed_status IN ('paid', 'confirmed', 'complete', 'completed', 'success'),
        false
    ) THEN
        RETURN NEW;
    END IF;
    SELECT p.* INTO v_payment FROM public.guest_shop_checkout_payments p
    WHERE p.merchant_order_no = NEW.merchant_order_no AND p.provider = NEW.provider FOR UPDATE;
    IF NOT FOUND THEN RETURN NEW; END IF;
    IF NEW.observed_amount IS DISTINCT FROM v_payment.expected_amount
       OR NEW.observed_currency IS DISTINCT FROM v_payment.currency
       OR NEW.observed_site IS DISTINCT FROM v_payment.site
       OR NEW.observed_purpose IS DISTINCT FROM 'shop_direct'
       OR NEW.provider_order_no IS NULL
       OR (v_payment.provider_order_no IS NOT NULL AND NEW.provider_order_no <> v_payment.provider_order_no) THEN
        RETURN NEW;
    END IF;
    SELECT b.* INTO v_batch FROM public.guest_shop_checkout_batches b
    WHERE b.id = v_payment.batch_id FOR UPDATE;
    IF v_payment.status IN ('pending', 'created', 'review') AND v_batch.payment_status IN ('pending', 'review') THEN
        UPDATE public.guest_shop_checkout_payments
        SET status = 'review', last_error_code = 'guest_checkout_batch_confirmation_failed',
            last_error_message = 'verified provider payment awaiting database confirmation', updated_at = clock_timestamp()
        WHERE id = v_payment.id;
        UPDATE public.guest_shop_checkout_batches
        SET payment_status = 'review', last_error_code = 'guest_checkout_batch_confirmation_failed',
            last_error_message = 'verified provider payment awaiting database confirmation', updated_at = clock_timestamp()
        WHERE id = v_batch.id;
    END IF;
    RETURN NEW;
END;
$hold$;

DROP TRIGGER IF EXISTS trg_guest_shop_hold_verified_checkout_batch ON public.guest_shop_payment_events;
CREATE TRIGGER trg_guest_shop_hold_verified_checkout_batch
BEFORE INSERT OR UPDATE OF signature_verified, amount_verified, currency_verified, final_status_verified
ON public.guest_shop_payment_events
FOR EACH ROW EXECUTE FUNCTION public.guest_shop_hold_verified_checkout_batch();

-- Existing verified events predate this trigger. Move their unpaid batches to
-- review now, so the expiry sweep does not repeatedly select those rows.
UPDATE public.guest_shop_checkout_payments p
SET status = 'review', last_error_code = 'guest_checkout_batch_confirmation_failed',
    last_error_message = 'verified provider payment awaiting database confirmation', updated_at = clock_timestamp()
WHERE p.status IN ('pending', 'created')
  AND EXISTS (
      SELECT 1 FROM public.guest_shop_checkout_batches b
      WHERE b.id = p.batch_id AND b.payment_status = 'pending'
  )
  AND public.guest_shop_checkout_batch_has_verified_payment(p.batch_id);

UPDATE public.guest_shop_checkout_batches b
SET payment_status = 'review', last_error_code = 'guest_checkout_batch_confirmation_failed',
    last_error_message = 'verified provider payment awaiting database confirmation', updated_at = clock_timestamp()
WHERE b.payment_status = 'pending'
  AND EXISTS (
      SELECT 1 FROM public.guest_shop_checkout_payments p
      WHERE p.batch_id = b.id AND p.status = 'review'
        AND p.last_error_code = 'guest_checkout_batch_confirmation_failed'
  )
  AND public.guest_shop_checkout_batch_has_verified_payment(b.id);

-- Also protect observations recorded before this migration. A cancellation or
-- expiry RPC is a transaction, so raising here rolls back its inventory release.
CREATE OR REPLACE FUNCTION public.guest_shop_guard_checkout_batch_reconciliation()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $guard$
BEGIN
    IF NEW.payment_status = 'expired' AND OLD.payment_status <> 'expired'
       AND (OLD.last_error_code = 'guest_checkout_batch_confirmation_failed'
            OR public.guest_shop_checkout_batch_has_verified_payment(OLD.id)) THEN
        RAISE EXCEPTION 'guest_checkout_batch_not_cancellable';
    END IF;
    IF NEW.payment_status = 'confirmed' AND OLD.last_error_code = 'guest_checkout_batch_confirmation_failed'
       AND NEW.last_error_code = 'guest_checkout_batch_confirmation_failed' THEN
        NEW.last_error_code := NULL;
        NEW.last_error_message := NULL;
    END IF;
    RETURN NEW;
END;
$guard$;

DROP TRIGGER IF EXISTS trg_guest_shop_guard_checkout_batch_reconciliation ON public.guest_shop_checkout_batches;
CREATE TRIGGER trg_guest_shop_guard_checkout_batch_reconciliation
BEFORE UPDATE OF payment_status ON public.guest_shop_checkout_batches
FOR EACH ROW EXECUTE FUNCTION public.guest_shop_guard_checkout_batch_reconciliation();

CREATE OR REPLACE FUNCTION public.guest_shop_clear_checkout_payment_reconciliation()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $clear$
BEGIN
    IF NEW.status = 'confirmed' AND OLD.last_error_code = 'guest_checkout_batch_confirmation_failed' THEN
        NEW.last_error_code := NULL;
        NEW.last_error_message := NULL;
    END IF;
    RETURN NEW;
END;
$clear$;

DROP TRIGGER IF EXISTS trg_guest_shop_clear_checkout_payment_reconciliation ON public.guest_shop_checkout_payments;
CREATE TRIGGER trg_guest_shop_clear_checkout_payment_reconciliation
BEFORE UPDATE OF status ON public.guest_shop_checkout_payments
FOR EACH ROW EXECUTE FUNCTION public.guest_shop_clear_checkout_payment_reconciliation();

REVOKE ALL ON FUNCTION public.guest_shop_checkout_batch_has_verified_payment(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guest_shop_hold_verified_checkout_batch() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guest_shop_guard_checkout_batch_reconciliation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guest_shop_clear_checkout_payment_reconciliation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_shop_checkout_batch_has_verified_payment(UUID) TO service_role;

COMMIT;

SELECT 'batch_confirmation_column_qualified' AS check_name,
    pg_get_functiondef('public.fn_guest_shop_confirm_checkout_batch_payment(uuid,text,text,numeric,text)'::REGPROCEDURE)
        ~ 'guest_shop_checkout_batches[.]payment_status[[:space:]]*<>[[:space:]]*''confirmed''' AS ok
UNION ALL
SELECT 'verified_payment_inventory_hold', EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.guest_shop_payment_events'::REGCLASS
    AND tgname = 'trg_guest_shop_hold_verified_checkout_batch' AND tgenabled IN ('O', 'A')
)
UNION ALL
SELECT 'paid_batch_expiry_guard', EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.guest_shop_checkout_batches'::REGCLASS
    AND tgname = 'trg_guest_shop_guard_checkout_batch_reconciliation' AND tgenabled IN ('O', 'A')
);
