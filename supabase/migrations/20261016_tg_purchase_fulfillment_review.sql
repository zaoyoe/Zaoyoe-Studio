-- Apply manually after 20261016_tg_purchase_zpay_reconciliation.sql.
-- Adds a service-only administrative approval; installing it never approves,
-- pays, refunds or fulfills any existing order and does not enable a worker.
BEGIN;

DO $$
BEGIN
    IF to_regprocedure('public.fn_tg_purchase_payment_reconciliation_ready()') IS NULL THEN
        RAISE EXCEPTION 'Apply the TG ZPay reconciliation migration first';
    END IF;
    IF NOT public.fn_tg_purchase_payment_reconciliation_ready() THEN
        RAISE EXCEPTION 'TG payment reconciliation prerequisite is not ready';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_index i
        WHERE i.indexrelid = to_regclass('public.idx_tg_redemption_orders_purchase')
          AND i.indrelid = 'public.tg_redemption_orders'::regclass AND i.indisunique AND i.indisvalid
          AND i.indnatts = 1 AND pg_get_indexdef(i.indexrelid, 1, true) = 'purchase_id'
          AND pg_get_expr(i.indpred, i.indrelid) = '(purchase_id IS NOT NULL)') THEN
        RAISE EXCEPTION 'TG purchase fulfillment uniqueness prerequisite is missing';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_tg_approve_purchase_fulfillment(
    p_order_no TEXT, p_actor_id UUID, p_expected_updated_at TIMESTAMPTZ,
    p_review_note TEXT, p_payment_checked_at TIMESTAMPTZ, p_verified_payment JSONB,
    p_confirm_no_refund BOOLEAN, p_confirm_no_delivery BOOLEAN
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_order public.tg_purchase_orders%ROWTYPE;
    v_fulfillment public.tg_redemption_orders%ROWTYPE;
    v_trade_no TEXT := p_verified_payment->>'provider_trade_no';
    v_previous_reason TEXT;
BEGIN
    -- The administrator API checks super-admin identity, Origin and JSON, then
    -- obtains this proof with server-held merchant credentials. Browser-supplied
    -- payment payloads are never forwarded to this service_role-only RPC.
    IF coalesce(p_order_no, '') !~ '^TGP-[A-Z0-9]{20}$' OR p_actor_id IS NULL
       OR p_expected_updated_at IS NULL OR p_payment_checked_at IS NULL
       OR p_payment_checked_at < clock_timestamp() - interval '120 seconds'
       OR p_payment_checked_at > clock_timestamp() + interval '5 seconds'
       OR p_review_note IS NULL OR char_length(btrim(p_review_note)) NOT BETWEEN 6 AND 500
       OR p_confirm_no_refund IS DISTINCT FROM true OR p_confirm_no_delivery IS DISTINCT FROM true
       OR jsonb_typeof(p_verified_payment) IS DISTINCT FROM 'object'
       OR p_verified_payment->>'verified_by' IS DISTINCT FROM 'authenticated_query'
       OR p_verified_payment->>'event_status' IS DISTINCT FROM 'paid'
       OR coalesce(v_trade_no, '') !~ '^[A-Za-z0-9_-]{1,128}$' THEN
        RETURN jsonb_build_object('success', false, 'code', 'invalid_review');
    END IF;
    -- Same lock order as settlement and checkout: trade, purchase, fulfillment.
    PERFORM pg_advisory_xact_lock(hashtextextended('tg-payment-trade:' || v_trade_no, 0));
    SELECT * INTO v_order FROM public.tg_purchase_orders WHERE order_no = p_order_no FOR UPDATE;
    IF v_order.id IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'not_found'); END IF;
    IF v_order.payment_provider IS DISTINCT FROM 'zpay' OR v_order.payment_channel NOT IN ('alipay', 'wxpay') THEN
        RETURN jsonb_build_object('success', false, 'code', 'provider_unsupported');
    END IF;
    IF v_order.cancelled_at IS NOT NULL THEN RETURN jsonb_build_object('success', false, 'code', 'cancelled_order'); END IF;
    IF v_order.paid_at IS NULL OR v_order.checkout_started_at IS NULL OR v_order.provider_trade_no IS NULL
       OR v_order.provider_trade_no = v_order.order_no THEN
        RETURN jsonb_build_object('success', false, 'code', 'payment_not_recorded');
    END IF;
    IF p_payment_checked_at < clock_timestamp() - interval '120 seconds'
       OR p_verified_payment->>'provider_order_no' IS DISTINCT FROM v_order.order_no
       OR p_verified_payment->>'merchant_id' IS DISTINCT FROM v_order.payment_merchant_id
       OR v_trade_no IS DISTINCT FROM v_order.provider_trade_no
       OR p_verified_payment->>'checkout_trade_no' IS DISTINCT FROM v_order.provider_trade_no
       OR p_verified_payment->>'payment_channel' IS DISTINCT FROM v_order.payment_channel
       OR p_verified_payment->>'amount_minor' IS DISTINCT FROM v_order.total_minor::TEXT
       OR p_verified_payment->>'currency' IS DISTINCT FROM v_order.currency
       OR v_order.currency IS DISTINCT FROM 'CNY'
       OR EXISTS (SELECT 1 FROM public.tg_purchase_orders other WHERE other.id <> v_order.id
            AND other.payment_provider = v_order.payment_provider AND other.payment_merchant_id = v_order.payment_merchant_id
            AND other.provider_trade_no = v_trade_no) THEN
        RETURN jsonb_build_object('success', false, 'code', 'payment_binding_mismatch');
    END IF;
    SELECT * INTO v_fulfillment FROM public.tg_redemption_orders WHERE purchase_id = v_order.id FOR UPDATE;
    IF v_fulfillment.id IS NOT NULL THEN
        -- Lost-response/concurrent retries may observe the original approval.
        -- Never reset the task, its lease, upstream ID, attempts or result.
        IF v_order.payment_status = 'paid' AND v_fulfillment.order_source = 'purchase' AND v_fulfillment.code_id IS NULL
           AND v_fulfillment.telegram_username IS NOT DISTINCT FROM v_order.telegram_username
           AND v_fulfillment.product_family IS NOT DISTINCT FROM v_order.product_family
           AND v_fulfillment.term_months IS NOT DISTINCT FROM v_order.term_months
           AND v_fulfillment.stars_quantity IS NOT DISTINCT FROM v_order.stars_quantity
           AND v_fulfillment.status_token_hash IS NOT DISTINCT FROM v_order.status_token_hash
           AND v_fulfillment.idempotency_key_hash = encode(sha256(convert_to('tg-purchase:' || v_order.id::TEXT, 'UTF8')), 'hex')
           AND v_fulfillment.provider_idempotency_key = 'tg-purchase-' || replace(v_order.id::TEXT, '-', '')
           AND EXISTS (SELECT 1 FROM public.tg_audit_events a WHERE a.target_type = 'purchase_order' AND a.target_id = v_order.id
               AND a.event_type = 'purchase_fulfillment_approved' AND a.metadata->>'fulfillment_id' = v_fulfillment.id::TEXT) THEN
            RETURN jsonb_build_object('success', true, 'existing', true, 'order', public.tg_purchase_order_json(v_order.id));
        END IF;
        RETURN jsonb_build_object('success', false, 'code', 'fulfillment_exists');
    END IF;
    IF v_order.updated_at IS DISTINCT FROM p_expected_updated_at THEN
        RETURN jsonb_build_object('success', false, 'code', 'review_stale');
    END IF;
    -- Deliberately narrow first approval: confirmed expired ZPay receipts only.
    -- Cancelled payments and uncertain/failed existing deliveries need a separate
    -- investigation; this function cannot initiate another upstream purchase.
    IF v_order.payment_status IS DISTINCT FROM 'manual_review'
       OR v_order.last_error_code IS DISTINCT FROM 'payment_received_after_expiry' THEN
        RETURN jsonb_build_object('success', false, 'code', 'not_reviewable');
    END IF;
    v_previous_reason := v_order.last_error_code;
    UPDATE public.tg_purchase_orders SET payment_status = 'paid', last_error_code = NULL,
        checkout_lease_token = NULL, checkout_lease_expires_at = NULL, updated_at = now()
    WHERE id = v_order.id RETURNING * INTO v_order;
    -- Preserve the original amount, receipt timestamp, trade and payment proof.
    -- Worker ownership and upstream idempotency are identical to normal settlement.
    INSERT INTO public.tg_redemption_orders(order_no, order_source, purchase_id, code_id, product_family, term_months,
        stars_quantity, telegram_username, status_token_hash, idempotency_key_hash, provider_idempotency_key)
    VALUES ('TG-' || upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 20)), 'purchase', v_order.id, NULL,
        v_order.product_family, v_order.term_months, v_order.stars_quantity, v_order.telegram_username,
        v_order.status_token_hash, encode(sha256(convert_to('tg-purchase:' || v_order.id::TEXT, 'UTF8')), 'hex'),
        'tg-purchase-' || replace(v_order.id::TEXT, '-', ''))
    RETURNING * INTO v_fulfillment;
    INSERT INTO public.tg_audit_events(actor_user_id, event_type, target_type, target_id, metadata)
    VALUES (p_actor_id, 'purchase_fulfillment_approved', 'purchase_order', v_order.id,
        jsonb_build_object('note', btrim(p_review_note), 'previous_reason', v_previous_reason,
            'payment_checked_at', p_payment_checked_at, 'verified_by', 'authenticated_query',
            'total_minor', v_order.total_minor, 'currency', v_order.currency,
            'confirm_no_refund', true, 'confirm_no_delivery', true, 'fulfillment_id', v_fulfillment.id));
    RETURN jsonb_build_object('success', true, 'existing', false, 'order', public.tg_purchase_order_json(v_order.id));
END;
$$;
REVOKE ALL ON FUNCTION public.fn_tg_approve_purchase_fulfillment(TEXT, UUID, TIMESTAMPTZ, TEXT, TIMESTAMPTZ, JSONB, BOOLEAN, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_approve_purchase_fulfillment(TEXT, UUID, TIMESTAMPTZ, TEXT, TIMESTAMPTZ, JSONB, BOOLEAN, BOOLEAN) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_tg_purchase_fulfillment_review_ready()
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT public.fn_tg_purchase_payment_reconciliation_ready()
        AND EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid = to_regclass('public.idx_tg_redemption_orders_purchase')
            AND i.indrelid = 'public.tg_redemption_orders'::regclass AND i.indisunique AND i.indisvalid
            AND i.indnatts = 1 AND pg_get_indexdef(i.indexrelid, 1, true) = 'purchase_id'
            AND pg_get_expr(i.indpred, i.indrelid) = '(purchase_id IS NOT NULL)')
        AND EXISTS (SELECT 1 FROM pg_proc WHERE oid =
            'public.fn_tg_approve_purchase_fulfillment(text,uuid,timestamptz,text,timestamptz,jsonb,boolean,boolean)'::regprocedure AND prosecdef)
        AND NOT has_function_privilege('anon',
            'public.fn_tg_approve_purchase_fulfillment(text,uuid,timestamptz,text,timestamptz,jsonb,boolean,boolean)', 'EXECUTE')
        AND NOT has_function_privilege('authenticated',
            'public.fn_tg_approve_purchase_fulfillment(text,uuid,timestamptz,text,timestamptz,jsonb,boolean,boolean)', 'EXECUTE')
        AND has_function_privilege('service_role',
            'public.fn_tg_approve_purchase_fulfillment(text,uuid,timestamptz,text,timestamptz,jsonb,boolean,boolean)', 'EXECUTE');
$$;
REVOKE ALL ON FUNCTION public.fn_tg_purchase_fulfillment_review_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_purchase_fulfillment_review_ready() TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
