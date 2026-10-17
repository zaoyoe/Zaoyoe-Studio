-- Operator-applied incremental migration; Codex does not execute SQL.
-- Apply after 20261017_tg_purchase_manual_completion.sql. Extends completion to
-- payment manual-review orders without a verified receipt or a delivery task.
-- Does not issue refunds, create deliveries, or alter recorded payment facts.
BEGIN;
DO $$
BEGIN
    IF to_regprocedure('public.fn_tg_purchase_completion_ready()') IS NULL THEN
        RAISE EXCEPTION 'Apply TG purchase manual completion first';
    END IF;
    IF NOT public.fn_tg_purchase_completion_ready() THEN
        RAISE EXCEPTION 'TG purchase manual completion is not ready';
    END IF;
END;
$$;
-- Replace only the completion constraint; preserve existing rows and records.
-- Do not tie no_valid_payment to paid_at IS NULL in this persistent constraint:
-- a late verified payment must still be retained after an administrative close.
ALTER TABLE public.tg_purchase_orders DROP CONSTRAINT tg_purchase_completion_record;
ALTER TABLE public.tg_purchase_orders ADD CONSTRAINT tg_purchase_completion_record CHECK (
    (completion_note IS NULL AND completion_outcome IS NULL AND completion_operation_id IS NULL AND completion_request_hash IS NULL)
    OR (closed_at IS NOT NULL AND closed_by IS NOT NULL AND completion_note IS NOT NULL
        AND char_length(btrim(completion_note)) BETWEEN 6 AND 500
        AND regexp_replace(completion_note, E'\n', '', 'g') !~ '[[:cntrl:]]'
        AND completion_outcome IS NOT NULL AND completion_outcome IN ('refunded','delivery_confirmed','agreed_settlement','no_valid_payment')
        AND completion_operation_id IS NOT NULL AND completion_request_hash IS NOT NULL AND completion_request_hash ~ '^[0-9a-f]{64}$')
);

CREATE OR REPLACE FUNCTION public.fn_tg_complete_purchase_review(
    p_order_no TEXT, p_actor_id UUID, p_expected_updated_at TIMESTAMPTZ,
    p_expected_task_id UUID, p_expected_task_updated_at TIMESTAMPTZ,
    p_operation_id UUID, p_request_hash TEXT, p_outcome TEXT,
    p_note TEXT, p_completion_note TEXT, p_confirm_payment_handled BOOLEAN,
    p_confirm_stop_fulfillment BOOLEAN, p_confirm_upstream_risk BOOLEAN
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_order public.tg_purchase_orders%ROWTYPE;
    v_task public.tg_redemption_orders%ROWTYPE;
    v_closed_at TIMESTAMPTZ;
BEGIN
    IF coalesce(p_order_no, '') !~ '^TGP-[A-Z0-9]{20}$' OR p_actor_id IS NULL OR p_expected_updated_at IS NULL
       OR p_operation_id IS NULL OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
       OR p_outcome IS NULL OR p_outcome NOT IN ('refunded','delivery_confirmed','agreed_settlement','no_valid_payment')
       OR (p_expected_task_id IS NULL) IS DISTINCT FROM (p_expected_task_updated_at IS NULL)
       OR p_note IS NULL OR char_length(btrim(p_note)) NOT BETWEEN 6 AND 500
       OR p_completion_note IS NULL OR char_length(btrim(p_completion_note)) NOT BETWEEN 6 AND 500
       OR regexp_replace(p_note, E'\n', '', 'g') ~ '[[:cntrl:]]'
       OR regexp_replace(p_completion_note, E'\n', '', 'g') ~ '[[:cntrl:]]'
       OR p_confirm_payment_handled IS DISTINCT FROM true OR p_confirm_stop_fulfillment IS DISTINCT FROM true
       OR p_confirm_upstream_risk IS DISTINCT FROM true THEN
        RETURN jsonb_build_object('success', false, 'code', 'invalid_completion');
    END IF;
    -- Same lock order as claim, callback, approval and finish: purchase, task.
    SELECT * INTO v_order FROM public.tg_purchase_orders WHERE order_no = p_order_no FOR UPDATE;
    IF v_order.id IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'completion_not_allowed'); END IF;
    IF v_order.closed_at IS NOT NULL THEN
        -- A response-loss retry is accepted only for the identical actor/request.
        IF v_order.completion_operation_id = p_operation_id AND v_order.closed_by = p_actor_id
           AND v_order.completion_request_hash = p_request_hash THEN
            RETURN jsonb_build_object('success', true, 'existing', true, 'order', public.tg_purchase_order_json(v_order.id));
        END IF;
        RETURN jsonb_build_object('success', false, 'code', 'order_closed');
    END IF;
    IF EXISTS (SELECT 1 FROM public.tg_purchase_orders WHERE completion_operation_id = p_operation_id) THEN
        RETURN jsonb_build_object('success', false, 'code', 'completion_conflict');
    END IF;
    IF v_order.updated_at IS DISTINCT FROM p_expected_updated_at THEN
        RETURN jsonb_build_object('success', false, 'code', 'completion_stale');
    END IF;
    IF v_order.payment_status NOT IN ('paid','manual_review') OR v_order.cancelled_at IS NOT NULL
        OR (v_order.paid_at IS NULL AND v_order.payment_status IS DISTINCT FROM 'manual_review') THEN
        RETURN jsonb_build_object('success', false, 'code', 'completion_not_allowed');
    END IF;
    IF v_order.checkout_lease_token IS NOT NULL OR v_order.checkout_lease_expires_at IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'completion_active');
    END IF;
    SELECT * INTO v_task FROM public.tg_redemption_orders WHERE purchase_id = v_order.id FOR UPDATE;
    IF (SELECT count(*) FROM public.tg_redemption_orders WHERE purchase_id = v_order.id) > 1 THEN
        RETURN jsonb_build_object('success', false, 'code', 'completion_not_allowed');
    END IF;
    IF v_task.id IS DISTINCT FROM p_expected_task_id OR v_task.updated_at IS DISTINCT FROM p_expected_task_updated_at THEN
        RETURN jsonb_build_object('success', false, 'code', 'completion_stale');
    END IF;
    -- A payment exception without a verified receipt cannot own any delivery
    -- task. A later payment callback takes the same purchase lock and is retained
    -- for manual review after close, without creating a fulfillment task.
    IF v_order.paid_at IS NULL AND v_task.id IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'completion_not_allowed');
    END IF;
    IF (v_order.paid_at IS NULL AND p_outcome = 'delivery_confirmed')
        OR (v_order.paid_at IS NOT NULL AND p_outcome = 'no_valid_payment') THEN
        RETURN jsonb_build_object('success', false, 'code', 'completion_outcome_mismatch');
    END IF;
    IF v_task.id IS NOT NULL AND (v_task.order_source IS DISTINCT FROM 'purchase' OR v_task.code_id IS NOT NULL
        OR v_task.telegram_username IS DISTINCT FROM v_order.telegram_username
        OR v_task.product_family IS DISTINCT FROM v_order.product_family
        OR v_task.term_months IS DISTINCT FROM v_order.term_months
        OR v_task.stars_quantity IS DISTINCT FROM v_order.stars_quantity) THEN
        RETURN jsonb_build_object('success', false, 'code', 'completion_not_allowed');
    END IF;
    IF v_task.id IS NOT NULL AND (v_task.status NOT IN ('manual_review','failed')
        OR v_task.lease_token IS NOT NULL OR v_task.lease_expires_at IS NOT NULL) THEN
        RETURN jsonb_build_object('success', false, 'code', 'completion_active');
    END IF;
    v_closed_at := clock_timestamp();
    -- Do not reset submission/attempt/idempotency history or set succeeded or
    -- completed_at. Worker claim excludes cancelled; finish requires a live lease.
    IF v_task.id IS NOT NULL THEN
        UPDATE public.tg_redemption_orders SET status = 'cancelled', updated_at = v_closed_at WHERE id = v_task.id;
    END IF;
    -- Retain payment_status, paid_at, provider identifiers and receipt facts.
    UPDATE public.tg_purchase_orders SET closed_at = v_closed_at, closed_by = p_actor_id, close_note = btrim(p_note),
        completion_note = btrim(p_completion_note), completion_outcome = p_outcome,
        completion_operation_id = p_operation_id, completion_request_hash = p_request_hash, updated_at = v_closed_at WHERE id = v_order.id;
    INSERT INTO public.tg_audit_events(actor_user_id,event_type,target_type,target_id,metadata)
    VALUES(p_actor_id, 'purchase_manually_completed', 'purchase_order', v_order.id,
        jsonb_build_object('note', btrim(p_note), 'completion_note', btrim(p_completion_note), 'outcome', p_outcome,
            'payment_unverified', v_order.paid_at IS NULL, 'operation_id', p_operation_id, 'fulfillment_id', v_task.id, 'previous_fulfillment_status', v_task.status,
            'upstream_submitted', v_task.submitted_at IS NOT NULL OR v_task.provider_order_id IS NOT NULL OR v_task.attempt_count > 0,
            'confirm_payment_handled', true, 'confirm_stop_fulfillment', true, 'confirm_upstream_risk', true));
    RETURN jsonb_build_object('success', true, 'existing', false, 'order', public.tg_purchase_order_json(v_order.id));
EXCEPTION WHEN unique_violation THEN
    -- Includes a concurrent operation-id collision on another purchase. This
    -- exception block rolls back every state change and audit insert above.
    RETURN jsonb_build_object('success', false, 'code', 'completion_conflict');
END;
$$;
REVOKE ALL ON FUNCTION public.fn_tg_complete_purchase_review(TEXT,UUID,TIMESTAMPTZ,UUID,TIMESTAMPTZ,UUID,TEXT,TEXT,TEXT,TEXT,BOOLEAN,BOOLEAN,BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_complete_purchase_review(TEXT,UUID,TIMESTAMPTZ,UUID,TIMESTAMPTZ,UUID,TEXT,TEXT,TEXT,TEXT,BOOLEAN,BOOLEAN,BOOLEAN) TO service_role;
CREATE OR REPLACE FUNCTION public.fn_tg_purchase_payment_review_completion_ready()
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT coalesce(public.fn_tg_purchase_completion_ready()
        AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.tg_purchase_orders'::regclass
            AND conname = 'tg_purchase_completion_record' AND convalidated
            AND strpos(pg_get_constraintdef(oid), 'no_valid_payment') > 0)
        AND strpos(pg_get_functiondef(to_regprocedure('public.fn_tg_complete_purchase_review(text,uuid,timestamptz,uuid,timestamptz,uuid,text,text,text,text,boolean,boolean,boolean)')), 'v_order.paid_at IS NULL AND v_task.id IS NOT NULL') > 0
        AND strpos(pg_get_functiondef(to_regprocedure('public.fn_tg_complete_purchase_review(text,uuid,timestamptz,uuid,timestamptz,uuid,text,text,text,text,boolean,boolean,boolean)')), 'completion_outcome_mismatch') > 0
        AND strpos(pg_get_functiondef(to_regprocedure('public.fn_tg_confirm_purchase_payment(text,text,text,text,text,bigint,text,jsonb)')), 'v_order.closed_at IS NOT NULL') > 0
        AND strpos(pg_get_functiondef(to_regprocedure('public.fn_tg_confirm_purchase_payment(text,text,text,text,text,bigint,text,jsonb)')), 'payment_received_after_close') > 0, false);
$$;
REVOKE ALL ON FUNCTION public.fn_tg_purchase_payment_review_completion_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_purchase_payment_review_completion_ready() TO service_role;
DO $$
BEGIN
    IF NOT public.fn_tg_purchase_payment_review_completion_ready() THEN
        RAISE EXCEPTION 'TG payment-review completion or late-payment safeguards are not ready';
    END IF;
END;
$$;
NOTIFY pgrst, 'reload schema';
COMMIT;
