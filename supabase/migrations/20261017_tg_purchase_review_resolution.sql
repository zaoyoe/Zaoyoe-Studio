-- Execute manually after 20261016_tg_purchase_fulfillment_review.sql.
-- Installs capabilities only. Does not close, refund, pay or fulfill any order.
BEGIN;
DO $$
BEGIN
    IF to_regprocedure('public.fn_tg_purchase_fulfillment_review_ready()') IS NULL THEN
        RAISE EXCEPTION 'Apply TG purchase fulfillment review first';
    END IF;
    IF NOT public.fn_tg_purchase_fulfillment_review_ready() THEN
        RAISE EXCEPTION 'TG purchase fulfillment review is not ready';
    END IF;
END;
$$;
ALTER TABLE public.tg_purchase_orders
    ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS close_note TEXT;
ALTER TABLE public.tg_purchase_orders DROP CONSTRAINT IF EXISTS tg_purchase_close_note_check;
ALTER TABLE public.tg_purchase_orders ADD CONSTRAINT tg_purchase_close_note_check CHECK (
    (closed_at IS NULL AND closed_by IS NULL AND close_note IS NULL)
    OR (closed_at IS NOT NULL AND char_length(btrim(close_note)) BETWEEN 6 AND 500)
);

CREATE OR REPLACE FUNCTION public.tg_purchase_order_json(p_order_id UUID)
RETURNS JSONB LANGUAGE SQL SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT jsonb_build_object('id', p.id, 'order_no', p.order_no, 'quote_id', p.quote_id,
        'product_family', p.product_family, 'term_months', p.term_months, 'stars_quantity', p.stars_quantity,
        'telegram_username', p.telegram_username, 'currency', p.currency, 'total_minor', p.total_minor,
        'subtotal_minor', p.subtotal_minor, 'payment_fee_minor', p.payment_fee_minor,
        'payment_fee_rate_bps', p.payment_fee_rate_bps, 'price_version', p.price_version, 'payment_channel', p.payment_channel,
        'payment_provider', p.payment_provider, 'payment_merchant_id', p.payment_merchant_id,
        'payment_status', p.payment_status, 'checkout_url', p.checkout_url, 'crypto_checkout', p.crypto_checkout, 'provider_trade_no', p.provider_trade_no,
        'payment_expires_at', p.payment_expires_at, 'expires_at', p.payment_expires_at,
        'paid_at', p.paid_at, 'created_at', p.created_at, 'updated_at', p.updated_at, 'closed_at', p.closed_at,
        'fulfillment_status', CASE WHEN p.closed_at IS NOT NULL THEN 'closed' ELSE coalesce(f.status, 'not_started') END,
        'fulfillment_order_no', f.order_no)
    FROM public.tg_purchase_orders p LEFT JOIN public.tg_redemption_orders f ON f.purchase_id = p.id
    WHERE p.id = p_order_id;
$$;
CREATE OR REPLACE VIEW public.tg_purchase_order_stats AS
SELECT p.id, p.order_no, p.product_key, p.telegram_username, p.product_family,
    p.term_months, p.stars_quantity, p.currency, p.total_minor, p.payment_channel,
    p.payment_status, CASE WHEN p.closed_at IS NOT NULL THEN 'closed' ELSE coalesce(f.status, 'not_started') END AS fulfillment_status,
    p.created_at, p.updated_at, p.payment_expires_at AS expires_at, p.price_version,
    p.subtotal_minor, p.payment_fee_minor, p.payment_fee_rate_bps, p.closed_at
FROM public.tg_purchase_orders p LEFT JOIN public.tg_redemption_orders f ON f.purchase_id = p.id;
REVOKE ALL ON public.tg_purchase_order_stats FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.tg_purchase_order_stats TO service_role;

CREATE OR REPLACE FUNCTION public.fn_tg_resolve_purchase_review(
    p_order_no TEXT, p_actor_id UUID, p_action TEXT, p_expected_updated_at TIMESTAMPTZ,
    p_expected_task_updated_at TIMESTAMPTZ, p_note TEXT, p_confirm_no_delivery BOOLEAN,
    p_confirm_payment_handled BOOLEAN, p_checked_at TIMESTAMPTZ, p_upstream_snapshot JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_order public.tg_purchase_orders%ROWTYPE;
    v_task public.tg_redemption_orders%ROWTYPE;
    v_pristine BOOLEAN;
    v_verified BOOLEAN := false;
BEGIN
    IF coalesce(p_order_no, '') !~ '^TGP-[A-Z0-9]{20}$' OR p_actor_id IS NULL
       OR p_action IS NULL OR p_action NOT IN ('close_order', 'resume_fulfillment')
       OR p_expected_updated_at IS NULL OR p_checked_at IS NULL
       OR p_checked_at < clock_timestamp() - interval '120 seconds' OR p_checked_at > clock_timestamp() + interval '5 seconds'
       OR p_note IS NULL OR char_length(btrim(p_note)) NOT BETWEEN 6 AND 500
       OR p_confirm_no_delivery IS DISTINCT FROM true OR p_confirm_payment_handled IS DISTINCT FROM true
       OR jsonb_typeof(p_upstream_snapshot) IS DISTINCT FROM 'object' THEN
        RETURN jsonb_build_object('success', false, 'code', 'invalid_resolution');
    END IF;
    -- Same lock order as worker claim/finish, settlement and approval: purchase, task.
    SELECT * INTO v_order FROM public.tg_purchase_orders WHERE order_no = p_order_no FOR UPDATE;
    IF v_order.id IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'not_reviewable'); END IF;
    IF v_order.closed_at IS NOT NULL THEN
        IF p_action = 'close_order' THEN
            RETURN jsonb_build_object('success', true, 'existing', true, 'order', public.tg_purchase_order_json(v_order.id));
        END IF;
        RETURN jsonb_build_object('success', false, 'code', 'order_closed');
    END IF;
    IF v_order.updated_at IS DISTINCT FROM p_expected_updated_at THEN
        RETURN jsonb_build_object('success', false, 'code', 'resolution_stale');
    END IF;
    IF v_order.paid_at IS NULL OR v_order.payment_status NOT IN ('paid', 'manual_review') OR v_order.cancelled_at IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'not_reviewable');
    END IF;
    SELECT * INTO v_task FROM public.tg_redemption_orders WHERE purchase_id = v_order.id FOR UPDATE;
    IF v_task.updated_at IS DISTINCT FROM p_expected_task_updated_at THEN
        RETURN jsonb_build_object('success', false, 'code', 'resolution_stale');
    END IF;
    IF v_task.id IS NOT NULL AND (
        v_task.order_source <> 'purchase' OR v_task.code_id IS NOT NULL
        OR v_task.telegram_username IS DISTINCT FROM v_order.telegram_username
        OR v_task.product_family IS DISTINCT FROM v_order.product_family
        OR v_task.term_months IS DISTINCT FROM v_order.term_months
        OR v_task.stars_quantity IS DISTINCT FROM v_order.stars_quantity
        OR v_task.status NOT IN ('manual_review', 'failed') OR v_task.lease_token IS NOT NULL OR v_task.lease_expires_at IS NOT NULL
    ) THEN RETURN jsonb_build_object('success', false, 'code', 'fulfillment_active'); END IF;
    v_pristine := v_task.id IS NULL OR (v_task.submitted_at IS NULL AND v_task.provider_order_id IS NULL
        AND v_task.attempt_count = 0 AND NOT EXISTS (SELECT 1 FROM public.tg_fulfillment_attempts WHERE order_id = v_task.id));
    -- This proof is fetched by the API, never accepted from browser input. An
    -- empty search result, timeout, balance or create response is insufficient.
    v_verified := v_task.id IS NOT NULL AND v_task.provider_order_id IS NOT NULL AND v_task.submitted_at IS NOT NULL
        AND p_upstream_snapshot->>'provider_order_id' = v_task.provider_order_id
        AND p_upstream_snapshot->>'verified_by' = 'order_get' AND p_upstream_snapshot->>'method' = 'api'
        AND lower(regexp_replace(coalesce(p_upstream_snapshot->>'telegram_username', ''), '^@', '')) = v_task.telegram_username
        AND p_upstream_snapshot->>'product_family' = v_task.product_family
        AND p_upstream_snapshot->>'currency' = CASE v_task.provider_payment_currency WHEN 'gram' THEN 'gram' WHEN 'usdt' THEN 'usd' ELSE NULL END
        AND ((v_task.product_family = 'telegram_premium' AND p_upstream_snapshot->>'term_months' = v_task.term_months::TEXT)
            OR (v_task.product_family = 'telegram_stars' AND p_upstream_snapshot->>'stars_quantity' = v_task.stars_quantity::TEXT));
    IF p_action = 'close_order' THEN
        IF NOT v_pristine AND NOT coalesce(v_verified AND p_upstream_snapshot->>'provider_status' IN ('failed', 'canceled')
            AND p_upstream_snapshot->'completed' = 'false'::JSONB, false) THEN
            RETURN jsonb_build_object('success', false, 'code', 'delivery_uncertain');
        END IF;
        IF v_task.id IS NOT NULL THEN
            UPDATE public.tg_redemption_orders SET status = 'cancelled', updated_at = clock_timestamp() WHERE id = v_task.id;
        END IF;
        -- Preserve payment_status, paid_at and provider identifiers. This is not a refund.
        UPDATE public.tg_purchase_orders SET closed_at = clock_timestamp(), closed_by = p_actor_id, close_note = btrim(p_note), updated_at = clock_timestamp()
        WHERE id = v_order.id;
    ELSE
        IF v_task.id IS NULL OR v_order.payment_status <> 'paid' OR NOT (v_pristine OR coalesce(v_verified
            AND p_upstream_snapshot->>'provider_status' IN ('created', 'processing', 'completed'), false)) THEN
            RETURN jsonb_build_object('success', false, 'code', 'delivery_uncertain');
        END IF;
        -- Never erase submission/attempt/idempotency evidence. Existing upstream
        -- orders only enter the poll path; pristine tasks can make their first buy.
        UPDATE public.tg_redemption_orders SET status = CASE WHEN v_pristine THEN 'pending' ELSE 'retry_waiting' END,
            next_attempt_at = clock_timestamp(), updated_at = clock_timestamp() WHERE id = v_task.id;
        UPDATE public.tg_purchase_orders SET updated_at = clock_timestamp() WHERE id = v_order.id;
    END IF;
    INSERT INTO public.tg_audit_events(actor_user_id,event_type,target_type,target_id,metadata)
    VALUES(p_actor_id, CASE WHEN p_action = 'close_order' THEN 'purchase_order_closed' ELSE 'purchase_fulfillment_resumed' END,
        'purchase_order', v_order.id, jsonb_build_object('note', btrim(p_note), 'fulfillment_id', v_task.id,
            'previous_fulfillment_status', v_task.status, 'checked_at', p_checked_at,
            'upstream_status', p_upstream_snapshot->>'provider_status', 'confirm_no_delivery', true, 'confirm_payment_handled', true));
    RETURN jsonb_build_object('success', true, 'existing', false, 'order', public.tg_purchase_order_json(v_order.id));
END;
$$;
REVOKE ALL ON FUNCTION public.fn_tg_resolve_purchase_review(TEXT, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, BOOLEAN, BOOLEAN, TIMESTAMPTZ, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_resolve_purchase_review(TEXT, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, BOOLEAN, BOOLEAN, TIMESTAMPTZ, JSONB) TO service_role;

-- Guard the existing approval RPC while preserving its audited payment proof,
-- idempotency and locking logic. Abort on an unexpected function definition.
DO $$
DECLARE v_source TEXT; v_marker TEXT := 'IF v_order.cancelled_at IS NOT NULL THEN';
BEGIN
    SELECT pg_get_functiondef('public.fn_tg_approve_purchase_fulfillment(text,uuid,timestamptz,text,timestamptz,jsonb,boolean,boolean)'::regprocedure) INTO v_source;
    IF strpos(v_source, 'IF v_order.closed_at IS NOT NULL THEN') = 0 THEN
        IF strpos(v_source, v_marker) = 0 THEN RAISE EXCEPTION 'Unrecognized TG approval definition'; END IF;
        EXECUTE replace(v_source, v_marker,
            'IF v_order.closed_at IS NOT NULL THEN RETURN jsonb_build_object(''success'', false, ''code'', ''order_closed''); END IF; ' || v_marker);
    END IF;
END;
$$;
CREATE OR REPLACE FUNCTION public.fn_tg_purchase_resolution_ready()
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT public.fn_tg_purchase_fulfillment_review_ready()
        AND strpos(pg_get_functiondef('public.fn_tg_approve_purchase_fulfillment(text,uuid,timestamptz,text,timestamptz,jsonb,boolean,boolean)'::regprocedure), 'IF v_order.closed_at IS NOT NULL THEN') > 0
        AND NOT has_function_privilege('anon', 'public.fn_tg_resolve_purchase_review(text,uuid,text,timestamptz,timestamptz,text,boolean,boolean,timestamptz,jsonb)', 'EXECUTE')
        AND NOT has_function_privilege('authenticated', 'public.fn_tg_resolve_purchase_review(text,uuid,text,timestamptz,timestamptz,text,boolean,boolean,timestamptz,jsonb)', 'EXECUTE')
        AND has_function_privilege('service_role', 'public.fn_tg_resolve_purchase_review(text,uuid,text,timestamptz,timestamptz,text,boolean,boolean,timestamptz,jsonb)', 'EXECUTE');
$$;
REVOKE ALL ON FUNCTION public.fn_tg_purchase_resolution_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_purchase_resolution_ready() TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
