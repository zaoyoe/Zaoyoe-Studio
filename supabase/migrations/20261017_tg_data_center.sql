-- TG data center v1. Operator-applied, read-only reporting; never settles,
-- closes, refunds or submits an order. Requires the reconciled TG runtime.
BEGIN;

-- Fail before creating any reporting objects if this database is still on an
-- older TG snapshot. Apply the reconciled runtime first; do not alter orders.
DO $$
DECLARE v_table TEXT; v_column TEXT;
BEGIN
    FOREACH v_table IN ARRAY ARRAY['tg_purchase_orders', 'tg_redemption_orders', 'tg_redemption_batches', 'tg_redemption_codes'] LOOP
        IF to_regclass('public.' || v_table) IS NULL THEN
            RAISE EXCEPTION 'TG data center prerequisite missing: %. Apply the reconciled TG runtime first.', v_table;
        END IF;
    END LOOP;
    FOREACH v_column IN ARRAY ARRAY['paid_at', 'closed_at', 'crypto_checkout', 'verified_payment', 'payment_fee_minor', 'payment_fee_rate_bps'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.tg_purchase_orders'::regclass AND attname = v_column AND NOT attisdropped) THEN
            RAISE EXCEPTION 'TG data center prerequisite missing: tg_purchase_orders.%. Apply the reconciled TG runtime first.', v_column;
        END IF;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.idx_tg_redemption_orders_purchase') AND indisunique AND indisvalid) THEN
        RAISE EXCEPTION 'TG data center requires the purchase fulfillment unique index from the reconciled TG runtime';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_admin_decimal(p_value TEXT)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
    SELECT CASE WHEN p_value ~ '^(0|[1-9][0-9]{0,12})([.][0-9]{1,18})?$' THEN p_value::NUMERIC ELSE NULL END;
$$;

-- One fact per purchase, even when a fulfillment row exists. No credentials,
-- addresses, code material or raw payment/provider payloads enter this view.
CREATE OR REPLACE VIEW public.tg_admin_purchase_facts AS
SELECT p.id, p.order_no, p.product_key, p.telegram_username, p.product_family,
    p.term_months, p.stars_quantity, p.currency, p.total_minor, p.subtotal_minor,
    p.payment_fee_minor, p.payment_fee_rate_bps, p.price_version,
    p.payment_channel, p.payment_status, p.created_at, p.updated_at,
    p.payment_expires_at AS expires_at, p.paid_at, p.closed_at,
    CASE WHEN p.closed_at IS NOT NULL THEN 'closed' ELSE coalesce(f.status, 'not_started') END AS fulfillment_status,
    coalesce(f.submitted_at, p.paid_at, p.created_at) AS attention_since,
    CASE WHEN p.payment_channel = 'usdt_bep20' THEN 'USDT' ELSE 'CNY' END AS receipt_currency,
    CASE WHEN p.payment_channel = 'usdt_bep20' AND p.crypto_checkout->>'pay_currency' IN ('usdtbsc', 'usdtton', 'usdtmatic', 'usdttrc20') THEN p.crypto_checkout->>'pay_currency' END AS pay_currency,
    coalesce(p.paid_at IS NOT NULL AND p.verified_payment->>'event_status' = 'paid' AND (
        (p.payment_provider = 'zpay' AND p.verified_payment->>'verified_by' IN ('signed_notify', 'authenticated_query'))
        OR (p.payment_provider = 'nowpayments' AND p.verified_payment->>'verified_by' = 'signed_notify_and_query')
    ), false) AS receipt_confirmed,
    CASE WHEN p.payment_provider = 'zpay' AND p.payment_channel IN ('alipay', 'wxpay') AND p.currency = 'CNY'
        THEN p.total_minor::NUMERIC / 100
        WHEN p.payment_provider = 'nowpayments' AND p.payment_channel = 'usdt_bep20'
            AND p.crypto_checkout->>'pay_currency' IN ('usdtbsc', 'usdtton', 'usdtmatic', 'usdttrc20')
            AND p.verified_payment->>'actually_paid_currency' = p.crypto_checkout->>'pay_currency'
            AND p.verified_payment->>'pay_currency' = p.crypto_checkout->>'pay_currency'
            AND public.tg_admin_decimal(p.verified_payment->>'actually_paid') >= public.tg_admin_decimal(p.crypto_checkout->>'pay_amount')
            AND public.tg_admin_decimal(p.crypto_checkout->>'pay_amount') > 0
        THEN public.tg_admin_decimal(p.verified_payment->>'actually_paid') ELSE NULL END AS receipt_amount
FROM public.tg_purchase_orders p LEFT JOIN public.tg_redemption_orders f ON f.purchase_id = p.id;

CREATE OR REPLACE FUNCTION public.tg_admin_attention_reason(
    p_payment TEXT, p_fulfillment TEXT, p_closed TIMESTAMPTZ, p_since TIMESTAMPTZ, p_as_of TIMESTAMPTZ
) RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
    SELECT CASE WHEN p_closed IS NOT NULL OR p_fulfillment IN ('succeeded', 'cancelled', 'closed') THEN NULL
        WHEN p_payment = 'manual_review' THEN 'payment_review'
        WHEN p_fulfillment = 'manual_review' THEN 'fulfillment_review'
        WHEN p_fulfillment = 'failed' THEN 'failed'
        WHEN (p_payment = 'paid' AND p_fulfillment = 'not_started' OR p_fulfillment IN ('pending', 'processing', 'retry_waiting'))
            AND p_since < p_as_of - interval '30 minutes' THEN 'overdue' ELSE NULL END;
$$;

CREATE OR REPLACE VIEW public.tg_admin_code_facts AS
SELECT c.id, c.batch_id, c.status, c.created_at, c.code_last4, c.reserved_at,
    c.reservation_expires_at, c.fulfillment_started_at, c.fulfilled_at, c.revoked_at,
    c.telegram_username, b.status AS batch_status, b.valid_from,
    least(c.expires_at, b.valid_until) AS expires_at
FROM public.tg_redemption_codes c JOIN public.tg_redemption_batches b ON b.id = c.batch_id;

CREATE OR REPLACE FUNCTION public.tg_admin_code_matches(
    p_status TEXT, p_batch_status TEXT, p_valid_from TIMESTAMPTZ, p_expiry TIMESTAMPTZ, p_as_of TIMESTAMPTZ, p_inventory TEXT
) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
    SELECT CASE WHEN p_inventory IS NULL OR p_inventory = 'all' THEN true
        WHEN p_inventory = 'used' THEN p_status = 'fulfilled'
        WHEN p_inventory = 'in_flight' THEN p_status IN ('reserved', 'fulfilling')
        WHEN p_inventory IN ('available', 'expiring') THEN p_status = 'available' AND p_batch_status = 'active'
            AND p_valid_from <= p_as_of AND (p_expiry IS NULL OR p_expiry > p_as_of)
            AND (p_inventory = 'available' OR p_expiry <= p_as_of + interval '7 days') ELSE false END;
$$;

CREATE INDEX IF NOT EXISTS idx_tg_purchase_paid_reporting ON public.tg_purchase_orders(paid_at) WHERE paid_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tg_fulfillment_completed_reporting ON public.tg_redemption_orders(completed_at) WHERE status = 'succeeded';

CREATE OR REPLACE FUNCTION public.fn_tg_admin_data_center(
    p_module TEXT, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ,
    p_previous_from TIMESTAMPTZ, p_previous_to TIMESTAMPTZ, p_as_of TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_result JSONB;
BEGIN
    IF p_module IS NULL OR p_module NOT IN ('business', 'operations', 'inventory')
        OR p_from IS NULL OR p_to IS NULL OR p_previous_from IS NULL OR p_previous_to IS NULL OR p_as_of IS NULL
        OR p_to < p_from OR p_to > p_as_of OR p_to - p_from > interval '93 days'
        OR p_previous_from >= p_from OR p_previous_to > p_from
        OR p_previous_to - p_previous_from <> p_to - p_from THEN
        RAISE EXCEPTION 'Invalid TG reporting window' USING ERRCODE = '22023';
    END IF;
    IF p_module = 'business' THEN
        WITH paid AS MATERIALIZED (
            SELECT *, CASE WHEN paid_at >= p_from AND paid_at < p_to THEN 'current' ELSE 'previous' END AS period
            FROM public.tg_admin_purchase_facts
            WHERE paid_at >= p_previous_from AND paid_at < p_to AND created_at <= p_as_of
                AND (paid_at >= p_from OR paid_at < p_previous_to)
        ), deliveries AS MATERIALIZED (
            SELECT *, CASE WHEN completed_at >= p_from AND completed_at < p_to THEN 'current' ELSE 'previous' END AS period
            FROM public.tg_redemption_orders WHERE status = 'succeeded' AND completed_at >= p_previous_from AND completed_at < p_to
                AND created_at <= p_as_of AND (completed_at >= p_from OR completed_at < p_previous_to)
        ), periods AS (SELECT unnest(ARRAY['current', 'previous']) AS period),
        sums AS (
            SELECT s.period,
                (SELECT count(*) FROM paid p WHERE p.period = s.period AND receipt_confirmed) AS paid_count,
                (SELECT count(*) FROM deliveries d WHERE d.period = s.period) AS completed_count,
                (SELECT count(*) FROM paid p WHERE p.period = s.period AND (NOT receipt_confirmed OR receipt_amount IS NULL)) AS unverified_count,
                (SELECT count(*) FROM paid p WHERE p.period = s.period AND receipt_confirmed AND payment_status = 'manual_review' AND closed_at IS NULL) AS review_count,
                (SELECT coalesce(sum(receipt_amount), 0)::TEXT FROM paid p WHERE p.period = s.period AND receipt_confirmed AND receipt_currency = 'CNY') AS cny,
                (SELECT coalesce(sum(receipt_amount), 0)::TEXT FROM paid p WHERE p.period = s.period AND receipt_confirmed AND receipt_currency = 'USDT') AS usdt,
                (SELECT coalesce(sum(receipt_amount), 0)::TEXT FROM paid p WHERE p.period = s.period AND receipt_confirmed AND receipt_currency = 'CNY' AND payment_status = 'manual_review' AND closed_at IS NULL) AS review_cny,
                (SELECT coalesce(sum(receipt_amount), 0)::TEXT FROM paid p WHERE p.period = s.period AND receipt_confirmed AND receipt_currency = 'USDT' AND payment_status = 'manual_review' AND closed_at IS NULL) AS review_usdt
            FROM periods s
        ), days AS (
            SELECT generate_series(p_from AT TIME ZONE 'Asia/Shanghai', (p_to - interval '1 microsecond') AT TIME ZONE 'Asia/Shanghai', interval '1 day')::DATE AS day
        ), products(product_family, term_months) AS (VALUES ('telegram_premium', 3), ('telegram_premium', 6), ('telegram_premium', 12), ('telegram_stars', NULL::INTEGER))
        SELECT jsonb_build_object('version', 1, 'module', p_module,
            'metrics', (SELECT jsonb_object_agg(period, to_jsonb(s) - 'period') FROM sums s),
            'comparable', (SELECT coalesce(min(created_at) <= p_previous_from, false) FROM (
                SELECT min(created_at) AS created_at FROM public.tg_purchase_orders
                UNION ALL SELECT min(created_at) FROM public.tg_redemption_orders) h),
            'trend', (SELECT coalesce(jsonb_agg(jsonb_build_object('date', day,
                'cny', (SELECT coalesce(sum(receipt_amount), 0)::TEXT FROM paid WHERE period = 'current' AND receipt_confirmed AND receipt_currency = 'CNY' AND (paid_at AT TIME ZONE 'Asia/Shanghai')::DATE = day),
                'usdt', (SELECT coalesce(sum(receipt_amount), 0)::TEXT FROM paid WHERE period = 'current' AND receipt_confirmed AND receipt_currency = 'USDT' AND (paid_at AT TIME ZONE 'Asia/Shanghai')::DATE = day)
            ) ORDER BY day), '[]'::JSONB) FROM days),
            'products', (SELECT jsonb_agg(jsonb_build_object('product_family', s.product_family, 'term_months', s.term_months,
                'paid_count', (SELECT count(*) FROM paid p WHERE period = 'current' AND receipt_confirmed AND p.product_family = s.product_family AND p.term_months IS NOT DISTINCT FROM s.term_months),
                'cny', (SELECT coalesce(sum(receipt_amount), 0)::TEXT FROM paid p WHERE period = 'current' AND receipt_confirmed AND receipt_currency = 'CNY' AND p.product_family = s.product_family AND p.term_months IS NOT DISTINCT FROM s.term_months),
                'usdt', (SELECT coalesce(sum(receipt_amount), 0)::TEXT FROM paid p WHERE period = 'current' AND receipt_confirmed AND receipt_currency = 'USDT' AND p.product_family = s.product_family AND p.term_months IS NOT DISTINCT FROM s.term_months),
                'stars_sold', (SELECT coalesce(sum(stars_quantity), 0) FROM paid p WHERE period = 'current' AND receipt_confirmed AND p.product_family = s.product_family AND p.term_months IS NOT DISTINCT FROM s.term_months),
                'completed_count', (SELECT count(*) FROM deliveries d WHERE period = 'current' AND d.product_family = s.product_family AND d.term_months IS NOT DISTINCT FROM s.term_months)
            ) ORDER BY s.product_family, s.term_months) FROM products s),
            'channels', (SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY payment_channel, pay_currency), '[]'::JSONB) FROM (
                SELECT payment_channel, pay_currency, count(*) AS paid_count, receipt_currency,
                    coalesce(sum(receipt_amount), 0)::TEXT AS amount FROM paid WHERE period = 'current' AND receipt_confirmed
                GROUP BY payment_channel, pay_currency, receipt_currency) c)
        ) INTO v_result;
    ELSIF p_module = 'operations' THEN
        WITH current_orders AS (
            SELECT 'purchase' AS kind, public.tg_admin_attention_reason(payment_status, fulfillment_status, closed_at, attention_since, p_as_of) AS reason,
                attention_since AS since, fulfillment_status AS status, payment_status FROM public.tg_admin_purchase_facts WHERE created_at <= p_as_of
            UNION ALL
            SELECT 'redemption', public.tg_admin_attention_reason(NULL, status, NULL, coalesce(submitted_at, created_at), p_as_of),
                coalesce(submitted_at, created_at), status, NULL::TEXT FROM public.tg_redemption_orders WHERE order_source = 'redemption' AND created_at <= p_as_of
        ), reasons AS (SELECT unnest(ARRAY['payment_review', 'fulfillment_review', 'failed', 'overdue']) AS reason)
        SELECT jsonb_build_object('version', 1, 'module', p_module,
            'total_attention', (SELECT count(*) FROM current_orders WHERE reason IS NOT NULL),
            'normal_queue', (SELECT count(*) FROM current_orders WHERE reason IS NULL AND (status IN ('pending', 'processing', 'retry_waiting') OR status = 'not_started' AND payment_status = 'paid')),
            'oldest_since', (SELECT min(since) FROM current_orders WHERE reason IS NOT NULL),
            'groups', (SELECT jsonb_agg(jsonb_build_object('reason', r.reason,
                'purchase_count', (SELECT count(*) FROM current_orders c WHERE c.reason = r.reason AND kind = 'purchase'),
                'redemption_count', (SELECT count(*) FROM current_orders c WHERE c.reason = r.reason AND kind = 'redemption'),
                'oldest_since', (SELECT min(since) FROM current_orders c WHERE c.reason = r.reason)
            )) FROM reasons r)
        ) INTO v_result;
    ELSE
        SELECT jsonb_build_object('version', 1, 'module', p_module,
            'generated', count(*), 'used', count(*) FILTER (WHERE status = 'fulfilled'),
            'available', count(*) FILTER (WHERE public.tg_admin_code_matches(status, batch_status, valid_from, expires_at, p_as_of, 'available')),
            'in_flight', count(*) FILTER (WHERE status IN ('reserved', 'fulfilling')),
            'expiring', count(*) FILTER (WHERE public.tg_admin_code_matches(status, batch_status, valid_from, expires_at, p_as_of, 'expiring')),
            'usage_rate', CASE WHEN count(*) = 0 THEN NULL ELSE round(count(*) FILTER (WHERE status = 'fulfilled') * 100.0 / count(*), 1) END
        ) INTO v_result FROM public.tg_admin_code_facts WHERE created_at <= p_as_of;
    END IF;
    RETURN v_result;
END;
$$;

-- This listing uses the same reporting facts and event time as the overview.
-- Inputs are allowlisted by the authenticated server; no dynamic SQL is used.
CREATE OR REPLACE FUNCTION public.fn_tg_admin_data_center_list(
    p_kind TEXT, p_filters JSONB, p_as_of TIMESTAMPTZ, p_page INTEGER DEFAULT 1, p_page_size INTEGER DEFAULT 25
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_result JSONB; v_offset INTEGER; v_from TIMESTAMPTZ := (p_filters->>'from')::TIMESTAMPTZ; v_to TIMESTAMPTZ := (p_filters->>'to')::TIMESTAMPTZ;
BEGIN
    IF p_kind IS NULL OR p_kind NOT IN ('purchase', 'order', 'batch', 'code') OR p_as_of IS NULL
        OR p_page IS NULL OR p_page NOT BETWEEN 1 AND 100000 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 1000
        OR jsonb_typeof(p_filters) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid TG drilldown' USING ERRCODE = '22023'; END IF;
    v_offset := (p_page - 1) * p_page_size;
    IF p_kind = 'purchase' THEN
        WITH matches AS MATERIALIZED (
            SELECT p.* FROM public.tg_admin_purchase_facts p WHERE p.created_at <= p_as_of
                AND (v_from IS NULL OR CASE WHEN p_filters->>'date_field' = 'paid_at' THEN p.paid_at ELSE p.created_at END >= v_from)
                AND (v_to IS NULL OR CASE WHEN p_filters->>'date_field' = 'paid_at' THEN p.paid_at ELSE p.created_at END < v_to)
                AND (p_filters->>'search' IS NULL OR p.order_no = p_filters->>'search')
                AND (p_filters->>'username' IS NULL OR p.telegram_username = p_filters->>'username')
                AND (p_filters->>'product_family' IS NULL OR p.product_family = p_filters->>'product_family')
                AND (p_filters->>'term_months' IS NULL OR p.term_months::TEXT = p_filters->>'term_months')
                AND (p_filters->>'payment_status' IS NULL OR p.payment_status = p_filters->>'payment_status' OR p_filters->>'payment_status' = 'pending' AND p.payment_status IN ('awaiting_payment', 'checkout_creating'))
                AND (p_filters->>'fulfillment_status' IS NULL OR p.fulfillment_status = p_filters->>'fulfillment_status')
                AND (p_filters->>'payment_channel' IS NULL OR p.payment_channel = p_filters->>'payment_channel')
                AND (p_filters->>'currency' IS NULL OR p.receipt_currency = p_filters->>'currency')
                AND (p_filters->>'pay_currency' IS NULL OR p.pay_currency = p_filters->>'pay_currency' OR p_filters->>'pay_currency' = 'unknown' AND p.pay_currency IS NULL)
                AND (p_filters->>'receipt' IS NULL
                    OR p_filters->>'receipt' = 'confirmed' AND p.receipt_confirmed
                    OR p_filters->>'receipt' = 'review' AND p.receipt_confirmed AND p.payment_status = 'manual_review' AND p.closed_at IS NULL
                    OR p_filters->>'receipt' = 'amount_unknown' AND p.paid_at IS NOT NULL AND (NOT p.receipt_confirmed OR p.receipt_amount IS NULL))
                AND (p_filters->>'attention' IS NULL OR public.tg_admin_attention_reason(p.payment_status, p.fulfillment_status, p.closed_at, p.attention_since, p_as_of) = p_filters->>'attention'
                    OR p_filters->>'attention' = 'all' AND public.tg_admin_attention_reason(p.payment_status, p.fulfillment_status, p.closed_at, p.attention_since, p_as_of) IS NOT NULL)
        ) SELECT jsonb_build_object('total', (SELECT count(*) FROM matches), 'rows', coalesce((SELECT jsonb_agg(to_jsonb(r) || jsonb_build_object('receipt_amount', r.receipt_amount::TEXT)) FROM (
            SELECT * FROM matches ORDER BY CASE WHEN p_filters->>'date_field' = 'paid_at' THEN paid_at ELSE created_at END DESC, id DESC LIMIT p_page_size OFFSET v_offset) r), '[]'::JSONB)) INTO v_result;
    ELSIF p_kind = 'order' THEN
        WITH matches AS MATERIALIZED (
            SELECT o.id, o.order_no, o.order_source, o.purchase_id, o.telegram_username, o.product_family, o.term_months, o.stars_quantity,
                o.status, o.provider, o.provider_order_id, o.provider_payment_currency, o.attempt_count, o.submitted_at,
                o.completed_at, o.last_error_code, o.last_error_message, o.created_at, o.updated_at
            FROM public.tg_redemption_orders o LEFT JOIN public.tg_admin_purchase_facts p ON p.id = o.purchase_id
            WHERE o.created_at <= p_as_of
                AND (v_from IS NULL OR CASE WHEN p_filters->>'date_field' = 'completed_at' THEN o.completed_at ELSE o.created_at END >= v_from)
                AND (v_to IS NULL OR CASE WHEN p_filters->>'date_field' = 'completed_at' THEN o.completed_at ELSE o.created_at END < v_to)
                AND (p_filters->>'search' IS NULL OR o.order_no = p_filters->>'search')
                AND (p_filters->>'username' IS NULL OR o.telegram_username = p_filters->>'username')
                AND (p_filters->>'product_family' IS NULL OR o.product_family = p_filters->>'product_family')
                AND (p_filters->>'term_months' IS NULL OR o.term_months::TEXT = p_filters->>'term_months')
                AND (p_filters->>'status' IS NULL OR o.status = p_filters->>'status')
                AND (coalesce(p_filters->>'order_source', 'all') = 'all' OR o.order_source = p_filters->>'order_source')
                AND (p_filters->>'attention' IS NULL
                    OR public.tg_admin_attention_reason(p.payment_status, o.status, p.closed_at, coalesce(o.submitted_at, p.paid_at, o.created_at), p_as_of) = p_filters->>'attention'
                    OR p_filters->>'attention' = 'all' AND public.tg_admin_attention_reason(p.payment_status, o.status, p.closed_at, coalesce(o.submitted_at, p.paid_at, o.created_at), p_as_of) IS NOT NULL)
        ) SELECT jsonb_build_object('total', (SELECT count(*) FROM matches), 'rows', coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM (
            SELECT * FROM matches ORDER BY CASE WHEN p_filters->>'date_field' = 'completed_at' THEN completed_at ELSE created_at END DESC, id DESC LIMIT p_page_size OFFSET v_offset) r), '[]'::JSONB)) INTO v_result;
    ELSE
        WITH code_matches AS MATERIALIZED (
            SELECT c.* FROM public.tg_admin_code_facts c WHERE c.created_at <= p_as_of
                AND public.tg_admin_code_matches(c.status, c.batch_status, c.valid_from, c.expires_at, p_as_of, p_filters->>'inventory')
                AND (p_filters->>'batch_id' IS NULL OR c.batch_id::TEXT = p_filters->>'batch_id')
        ), batches AS MATERIALIZED (
            SELECT b.id, b.batch_no, jsonb_build_object('name', b.metadata->>'name') AS metadata,
                b.product_family, b.term_months, b.stars_quantity, b.quantity,
                (SELECT count(*) FROM public.tg_admin_code_facts c WHERE c.batch_id = b.id AND c.created_at <= p_as_of) AS generated_count,
                (SELECT count(*) FROM public.tg_admin_code_facts c WHERE c.batch_id = b.id AND c.created_at <= p_as_of AND c.status = 'fulfilled') AS redeemed_count,
                b.status, b.valid_from, b.valid_until, b.created_at, b.updated_at,
                (SELECT count(*) FROM code_matches c WHERE c.batch_id = b.id) AS matching_code_count
            FROM public.tg_redemption_batches b WHERE b.created_at <= p_as_of
                AND (p_filters->>'inventory' IS NULL OR EXISTS(SELECT 1 FROM code_matches c WHERE c.batch_id = b.id))
                AND (p_filters->>'search' IS NULL OR b.batch_no = p_filters->>'search')
                AND (p_filters->>'product_family' IS NULL OR b.product_family = p_filters->>'product_family')
                AND (p_filters->>'term_months' IS NULL OR b.term_months::TEXT = p_filters->>'term_months')
                AND (p_filters->>'status' IS NULL OR b.status = p_filters->>'status')
                AND (v_from IS NULL OR b.created_at >= v_from) AND (v_to IS NULL OR b.created_at < v_to)
        ), rows AS (
            SELECT id, created_at, to_jsonb(b) AS row_data FROM batches b WHERE p_kind = 'batch'
            UNION ALL
            SELECT c.id, c.created_at, to_jsonb(c) - 'batch_status' - 'valid_from' FROM code_matches c WHERE p_kind = 'code'
        ) SELECT jsonb_build_object('total', (SELECT count(*) FROM rows),
            'matching_codes', (SELECT coalesce(sum(matching_code_count), 0) FROM batches),
            'rows', coalesce((SELECT jsonb_agg(row_data) FROM (SELECT row_data FROM rows ORDER BY created_at DESC, id DESC LIMIT p_page_size OFFSET v_offset) r), '[]'::JSONB)) INTO v_result;
    END IF;
    RETURN v_result;
END;
$$;

REVOKE ALL ON public.tg_admin_purchase_facts, public.tg_admin_code_facts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.tg_admin_purchase_facts, public.tg_admin_code_facts TO service_role;
REVOKE ALL ON FUNCTION public.fn_tg_admin_data_center(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_admin_data_center(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
REVOKE ALL ON FUNCTION public.fn_tg_admin_data_center_list(TEXT, JSONB, TIMESTAMPTZ, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_admin_data_center_list(TEXT, JSONB, TIMESTAMPTZ, INTEGER, INTEGER) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
