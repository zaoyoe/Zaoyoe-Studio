-- ============================================================================
-- P2E manual purchase, follow-up to 20261021_shop_supplier_platform_v2_manual_purchase.
--
-- Two corrections to the base migration, both required for a manual purchase to
-- be recoverable after a crash:
--
--   1. A `confirmed` row may carry the order number the supplier returned, so a
--      debit is never lost between the trade call and the receipt write. The
--      `quoted` row still may not carry an order number or an amount.
--   2. `fn_shop_supplier_manual_stage_v2` persists that order number and amount
--      as a durable `submitted` event before the delivery content is fetched.
--
-- Idempotent: safe to re-run, and a fresh install that already ran the updated
-- base migration is unaffected. No money moves, no supplier is called and no
-- policy switch is touched here.
-- ============================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
    IF to_regclass('public.shop_supplier_manual_purchases') IS NULL THEN
        RAISE EXCEPTION 'run 20261021_shop_supplier_platform_v2_manual_purchase.sql first';
    END IF;
END;
$$;

ALTER TABLE public.shop_supplier_manual_purchases
    DROP CONSTRAINT IF EXISTS shop_supplier_manual_purchase_state_check;
ALTER TABLE public.shop_supplier_manual_purchases
    ADD CONSTRAINT shop_supplier_manual_purchase_state_check CHECK (
        (state = 'quoted' AND confirmed_at IS NULL AND submitted_at IS NULL
            AND supplier_order_no IS NULL AND actual_amount_cny IS NULL AND failure_code IS NULL)
        OR (state = 'expired' AND supplier_order_no IS NULL AND actual_amount_cny IS NULL)
        OR (state = 'abandoned' AND supplier_order_no IS NULL AND actual_amount_cny IS NULL)
        OR (state = 'confirmed' AND confirmed_at IS NOT NULL AND submitted_at IS NOT NULL
            AND failure_code IS NULL
            AND (supplier_order_no IS NULL) = (actual_amount_cny IS NULL))
        OR (state = 'accepted' AND confirmed_at IS NOT NULL AND submitted_at IS NOT NULL
            AND supplier_order_no IS NOT NULL AND actual_amount_cny IS NOT NULL)
        OR (state = 'unknown' AND confirmed_at IS NOT NULL AND submitted_at IS NOT NULL
            AND supplier_order_no IS NULL AND actual_amount_cny IS NULL AND failure_code IS NOT NULL)
        OR (state = 'rejected' AND supplier_order_no IS NULL AND actual_amount_cny IS NULL
            AND failure_code IS NOT NULL)
    );

-- ---------------------------------------------------------------------------
-- Step 2b: persist what the supplier answered to the trade request BEFORE the
-- delivery content is fetched or the receipt is written.
--
-- The debit has already happened at this point, so the order number must be
-- durable even if the process dies before the receipt exists. That is the only
-- way a later "finalise" call can re-read the delivered card instead of asking
-- the supplier to trade again.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_shop_supplier_manual_stage_v2(
    p_purchase_id UUID, p_admin_id UUID, p_trade_no TEXT,
    p_actual_amount_cny TEXT, p_evidence_hash TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_purchase public.shop_supplier_manual_purchases%ROWTYPE;
    v_intent public.shop_supplier_procurement_intents%ROWTYPE;
    v_now TIMESTAMPTZ;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'supplier_service_role_required'; END IF;
    IF p_purchase_id IS NULL OR p_admin_id IS NULL
        OR p_trade_no IS NULL OR p_trade_no !~ '^[[:alnum:]_.:-]{1,160}$'
        OR p_actual_amount_cny IS NULL OR p_actual_amount_cny !~ '^[0-9]{1,12}(\.[0-9]{1,6})?$'
        OR p_evidence_hash IS NULL OR p_evidence_hash !~ '^[a-f0-9]{64}$' THEN
        RAISE EXCEPTION 'supplier_manual_invalid_request';
    END IF;
    SELECT * INTO v_purchase FROM public.shop_supplier_manual_purchases
        WHERE id = p_purchase_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'supplier_manual_purchase_missing'; END IF;
    SELECT * INTO v_intent FROM public.shop_supplier_procurement_intents
        WHERE id = v_purchase.intent_id FOR UPDATE;
    v_now := clock_timestamp();

    IF v_purchase.state IN ('accepted','unknown','rejected') THEN
        RETURN jsonb_build_object('status', v_purchase.state, 'staged', false, 'duplicate', true,
            'supplierOrderNo', v_purchase.supplier_order_no);
    END IF;
    IF v_purchase.state <> 'confirmed' THEN
        RAISE EXCEPTION 'supplier_manual_state_conflict';
    END IF;
    IF v_purchase.supplier_order_no IS NOT NULL THEN
        IF v_purchase.supplier_order_no IS DISTINCT FROM p_trade_no THEN
            RAISE EXCEPTION 'supplier_manual_identity_conflict';
        END IF;
        RETURN jsonb_build_object('status', 'confirmed', 'staged', false, 'duplicate', true,
            'supplierOrderNo', p_trade_no);
    END IF;
    UPDATE public.shop_supplier_manual_purchases
        SET supplier_order_no = p_trade_no, actual_amount_cny = p_actual_amount_cny::NUMERIC(18,6),
            updated_at = v_now
        WHERE id = v_purchase.id AND state = 'confirmed' AND supplier_order_no IS NULL;
    INSERT INTO public.shop_supplier_manual_purchase_events(purchase_id, intent_id, event_kind, actor_admin_id, detail)
    VALUES (v_purchase.id, v_intent.id, 'submitted', p_admin_id, jsonb_build_object(
        'supplierOrderNo', p_trade_no, 'actualAmountCny', p_actual_amount_cny,
        'quotedAmountCny', v_purchase.quoted_amount_cny::TEXT,
        'costCeilingCny', v_purchase.cost_ceiling_cny::TEXT, 'evidenceHash', p_evidence_hash));
    RETURN jsonb_build_object('status', 'confirmed', 'staged', true,
        'supplierOrderNo', p_trade_no, 'actualAmountCny', p_actual_amount_cny);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_shop_supplier_manual_stage_v2(UUID,UUID,TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_shop_supplier_manual_stage_v2(UUID,UUID,TEXT,TEXT,TEXT) TO service_role;

COMMIT;
