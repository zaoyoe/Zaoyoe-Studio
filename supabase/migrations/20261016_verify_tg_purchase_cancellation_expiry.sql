-- Read-only verification after the operator applies the matching migration.
BEGIN READ ONLY;

DO $$
DECLARE v_source TEXT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.tg_purchase_orders'::regclass
        AND conname = 'tg_purchase_orders_cancelled_check')
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.tg_purchase_orders'::regclass
        AND tgname = 'trg_tg_purchase_cancellation' AND tgenabled = 'O') THEN
        RAISE EXCEPTION 'TG cancellation guards missing';
    END IF;
    v_source := pg_get_functiondef('public.fn_tg_save_purchase_crypto_checkout(uuid,uuid,text,jsonb)'::regprocedure);
    IF position('5 minutes' IN v_source) > 0
       OR position('> v_order.payment_expires_at' IN v_source) = 0 THEN
        RAISE EXCEPTION 'TG checkout expiry contract mismatch';
    END IF;
    v_source := pg_get_functiondef('public.fn_tg_confirm_purchase_payment(text,text,text,text,text,bigint,text,jsonb)'::regprocedure);
    IF position('v_order.cancelled_at IS NOT NULL' IN v_source) = 0
       OR position('payment_received_after_cancellation' IN v_source) = 0
       OR position('v_order.total_minor IS DISTINCT FROM p_amount_minor' IN v_source) = 0
       OR position('signed_notify_and_query' IN v_source) = 0
       OR position('INSERT INTO public.tg_redemption_orders' IN v_source) < position('v_order.cancelled_at IS NOT NULL' IN v_source) THEN
        RAISE EXCEPTION 'TG cancelled settlement contract mismatch';
    END IF;
    v_source := pg_get_functiondef('public.fn_tg_cancel_purchase(text,character,text,boolean)'::regprocedure);
    IF position('status_token_hash = p_status_token_hash FOR UPDATE' IN v_source) = 0
       OR position('p_provider_checked IS DISTINCT FROM true' IN v_source) = 0
       OR position('v_order.paid_at IS NOT NULL' IN v_source) = 0 THEN
        RAISE EXCEPTION 'TG cancel authentication/locking contract mismatch';
    END IF;
    IF has_function_privilege('anon', 'public.fn_tg_cancel_purchase(text,character,text,boolean)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.fn_tg_cancel_purchase(text,character,text,boolean)', 'EXECUTE')
       OR NOT has_function_privilege('service_role', 'public.fn_tg_cancel_purchase(text,character,text,boolean)', 'EXECUTE') THEN
        RAISE EXCEPTION 'TG cancellation RPC privilege mismatch';
    END IF;
    IF EXISTS (SELECT 1 FROM public.tg_purchase_orders p
        WHERE p.cancelled_at IS NOT NULL AND (p.payment_status NOT IN ('cancelled', 'manual_review')
            OR EXISTS (SELECT 1 FROM public.tg_redemption_orders f WHERE f.purchase_id = p.id))) THEN
        RAISE EXCEPTION 'TG cancelled purchase has fulfillment or reopened payment';
    END IF;
END;
$$;

COMMIT;
