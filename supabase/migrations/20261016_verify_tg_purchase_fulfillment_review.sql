-- Optional read-only verification; apply manually after the approval migration.
-- No approval RPC is invoked, and no order, audit or worker data is modified.
DO $$
DECLARE
    v_source TEXT;
BEGIN
    IF to_regprocedure('public.fn_tg_purchase_fulfillment_review_ready()') IS NULL THEN
        RAISE EXCEPTION 'TG fulfillment review migration is missing';
    END IF;
    IF NOT public.fn_tg_purchase_fulfillment_review_ready() THEN
        RAISE EXCEPTION 'TG fulfillment review readiness check failed';
    END IF;
    v_source := pg_get_functiondef('public.fn_tg_approve_purchase_fulfillment(text,uuid,timestamptz,text,timestamptz,jsonb,boolean,boolean)'::regprocedure);
    IF position('purchase_fulfillment_approved' IN v_source) = 0
       OR position('p_expected_updated_at' IN v_source) = 0
       OR position('authenticated_query' IN v_source) = 0
       OR position('payment_received_after_expiry' IN v_source) = 0
       OR position('p_confirm_no_refund IS DISTINCT FROM true' IN v_source) = 0
       OR position('p_confirm_no_delivery IS DISTINCT FROM true' IN v_source) = 0 THEN
        RAISE EXCEPTION 'TG fulfillment review safety contract is incomplete';
    END IF;
    RAISE NOTICE 'TG purchase fulfillment review schema checks passed; no order was approved';
END;
$$;
SELECT public.fn_tg_purchase_fulfillment_review_ready() AS tg_purchase_fulfillment_review_ready;
