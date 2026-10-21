-- P2C durable, default-off dispatch protocol. Apply manually AFTER P2B.
-- No merchant proof, enabled policy, public route, worker or timer is installed.
-- Accepted is an upstream acknowledgement, NEVER customer delivery or actual cost.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- Reject an incompatible native schema before installing a guard that could
-- otherwise fail only on the first real order update. This does not run fixtures.
DO $$
DECLARE v_required RECORD;
BEGIN
    IF to_regprocedure('public.fn_purchase_shop_supplier_points_v2(uuid,uuid)') IS NULL THEN
        RAISE EXCEPTION 'Supplier P2B native checkout migration is required before P2C';
    END IF;
    FOR v_required IN SELECT r.table_name, unnest(r.columns) AS column_name FROM (VALUES
        ('shop_orders', ARRAY['id','fulfillment_source','delivery_status','refund_status','item_count','site',
            'product_id','sku_id','user_id','price_paid','total_price','discount_code','discount_amount',
            'discount_refund_amount','delivery_completed_at','inventory_id','delivery_task_id']),
        ('guest_shop_orders', ARRAY['id','fulfillment_source','payment_status','fulfillment_status','refund_status',
            'reservation_status','paid_at','fulfilled_at','site','product_id','sku_id','currency','quantity',
            'unit_amount','total_amount','payment_fee_amount'])
    ) AS r(table_name, columns) LOOP
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
            AND table_name = v_required.table_name AND column_name = v_required.column_name) THEN
            RAISE EXCEPTION 'Supplier P2C native schema incompatible: %.%', v_required.table_name, v_required.column_name;
        END IF;
    END LOOP;
END;
$$;

ALTER TABLE public.shop_supplier_transaction_policies
    ADD COLUMN IF NOT EXISTS dispatch_enabled BOOLEAN NOT NULL DEFAULT false;
-- Touching the native order fences a concurrent REPEATABLE READ refund snapshot.
ALTER TABLE public.shop_orders
    ADD COLUMN IF NOT EXISTS supplier_dispatch_version BIGINT NOT NULL DEFAULT 0 CHECK (supplier_dispatch_version >= 0);
ALTER TABLE public.guest_shop_orders
    ADD COLUMN IF NOT EXISTS supplier_dispatch_version BIGINT NOT NULL DEFAULT 0 CHECK (supplier_dispatch_version >= 0);
ALTER TABLE public.shop_supplier_procurement_intents DROP CONSTRAINT IF EXISTS shop_supplier_intent_status_check;
ALTER TABLE public.shop_supplier_procurement_intents ADD CONSTRAINT shop_supplier_intent_status_check
    CHECK (status IN ('not_submitted', 'prepared', 'dispatching', 'outcome_unknown', 'accepted', 'rejected', 'review'));
ALTER TABLE public.shop_supplier_procurement_intents DROP CONSTRAINT IF EXISTS shop_supplier_intent_unsubmitted_check;
ALTER TABLE public.shop_supplier_procurement_intents ADD CONSTRAINT shop_supplier_intent_unsubmitted_check CHECK (
    actual_cost_cny IS NULL AND ((status = 'accepted' AND supplier_order_no IS NOT NULL)
        OR (status <> 'accepted' AND supplier_order_no IS NULL))
);
ALTER TABLE public.shop_supplier_transaction_outbox DROP CONSTRAINT IF EXISTS shop_supplier_outbox_status_check;
ALTER TABLE public.shop_supplier_transaction_outbox ADD CONSTRAINT shop_supplier_outbox_status_check
    CHECK (status IN ('blocked', 'processing', 'awaiting_reconciliation', 'awaiting_delivery', 'rejected', 'review'));
ALTER TABLE public.shop_supplier_transaction_outbox DROP CONSTRAINT IF EXISTS shop_supplier_transaction_outbox_block_reason_check;
ALTER TABLE public.shop_supplier_transaction_outbox ADD CONSTRAINT shop_supplier_transaction_outbox_block_reason_check
    CHECK (block_reason IN ('procurement_contract_unverified', 'risk_budget_unavailable', 'customer_resolution_required',
        'dispatch_in_progress', 'outcome_unknown', 'supplier_accepted', 'supplier_rejected', 'reconciliation_exhausted'));

-- No rows are inserted here. A later merchant verification must archive evidence
-- for THIS account/ref and this exact contract before dispatch can be enabled.
CREATE TABLE IF NOT EXISTS public.shop_supplier_dispatch_verifications (
    supplier_account_id UUID PRIMARY KEY REFERENCES public.shop_supplier_accounts(id) ON DELETE RESTRICT,
    provider_id TEXT NOT NULL CHECK (provider_id ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
    credential_ref TEXT NOT NULL CHECK (credential_ref ~ '^env:[A-Z][A-Z0-9_]{0,119}$'),
    contract_hash TEXT NOT NULL CHECK (contract_hash = '4b6dbbf3491c950baeb4860d85128dcd2493ff4a1d61490a0c02892864fb9cae'),
    evidence_hash TEXT NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
    request_lookup_verified BOOLEAN NOT NULL DEFAULT false,
    immutable_request_key_verified BOOLEAN NOT NULL DEFAULT false,
    final_rejection_verified BOOLEAN NOT NULL DEFAULT false,
    atomic_cny_ceiling_verified BOOLEAN NOT NULL DEFAULT false,
    verified_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    verified_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL CHECK (expires_at > verified_at),
    is_enabled BOOLEAN NOT NULL DEFAULT false,
    CHECK (NOT is_enabled OR (request_lookup_verified AND immutable_request_key_verified
        AND final_rejection_verified AND atomic_cny_ceiling_verified))
);
CREATE TABLE IF NOT EXISTS public.shop_supplier_dispatch_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    intent_id UUID NOT NULL UNIQUE REFERENCES public.shop_supplier_procurement_intents(id) ON DELETE RESTRICT,
    supplier_account_id UUID NOT NULL REFERENCES public.shop_supplier_accounts(id) ON DELETE RESTRICT,
    original_request_id UUID NOT NULL,
    account_snapshot JSONB NOT NULL CHECK (jsonb_typeof(account_snapshot) = 'object'
        AND account_snapshot - ARRAY['id', 'provider_id', 'credential_ref'] = '{}'::JSONB
        AND account_snapshot->>'id' = supplier_account_id::TEXT),
    frozen_request JSONB NOT NULL CHECK (jsonb_typeof(frozen_request) = 'object'
        AND frozen_request - ARRAY['requestId', 'goodsNo', 'variant', 'quantity', 'maxCost'] = '{}'::JSONB
        AND frozen_request->>'requestId' = original_request_id::TEXT
        AND frozen_request->'quantity' = '1'::JSONB AND frozen_request->'maxCost'->>'currency' = 'CNY'),
    contract_hash TEXT NOT NULL CHECK (contract_hash = '4b6dbbf3491c950baeb4860d85128dcd2493ff4a1d61490a0c02892864fb9cae'),
    evidence_hash TEXT NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
    state TEXT NOT NULL CHECK (state IN ('prepared', 'dispatching', 'outcome_unknown', 'accepted', 'rejected', 'review')),
    lease_kind TEXT NOT NULL CHECK (lease_kind IN ('prepare', 'dispatch', 'query', 'none')),
    lease_token UUID,
    lease_expires_at TIMESTAMPTZ,
    request_started_at TIMESTAMPTZ,
    supplier_order_no TEXT CHECK (supplier_order_no ~ '^[[:alnum:]_.:-]{1,160}$'),
    query_count INTEGER NOT NULL DEFAULT 0 CHECK (query_count BETWEEN 0 AND 12),
    next_query_at TIMESTAMPTZ,
    reconcile_deadline_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (supplier_account_id, original_request_id),
    CHECK ((lease_kind = 'none' AND lease_token IS NULL AND lease_expires_at IS NULL)
        OR (lease_kind <> 'none' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
    CHECK ((state = 'prepared' AND request_started_at IS NULL AND lease_kind = 'prepare')
        OR (state = 'review' AND lease_kind = 'none')
        OR (state <> 'prepared' AND request_started_at IS NOT NULL)),
    CHECK ((state = 'accepted' AND supplier_order_no IS NOT NULL)
        OR (state <> 'accepted' AND supplier_order_no IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_shop_supplier_dispatch_due
    ON public.shop_supplier_dispatch_attempts(next_query_at) WHERE state IN ('dispatching', 'outcome_unknown');
CREATE TABLE IF NOT EXISTS public.shop_supplier_dispatch_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id UUID NOT NULL REFERENCES public.shop_supplier_dispatch_attempts(id) ON DELETE RESTRICT,
    event_type TEXT NOT NULL CHECK (event_type IN ('prepare', 'begin', 'claim_query', 'expired', 'review', 'result')),
    token_hash TEXT NOT NULL CHECK (token_hash ~ '^[a-f0-9]{64}$'),
    result_hash TEXT CHECK (result_hash ~ '^[a-f0-9]{64}$'),
    result JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(result) = 'object'
        AND result - ARRAY['outcome', 'requestId', 'code', 'orderNo', 'evidenceHash'] = '{}'::JSONB),
    response JSONB NOT NULL CHECK (jsonb_typeof(response) = 'object'
        AND response - ARRAY['status', 'applied', 'acquired'] = '{}'::JSONB),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (attempt_id, event_type, token_hash),
    CHECK ((event_type = 'result' AND result_hash IS NOT NULL) OR (event_type <> 'result' AND result_hash IS NULL))
);
ALTER TABLE public.shop_supplier_dispatch_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_supplier_dispatch_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_supplier_dispatch_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_supplier_dispatch_verifications, public.shop_supplier_dispatch_attempts,
    public.shop_supplier_dispatch_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.shop_supplier_dispatch_verifications, public.shop_supplier_dispatch_attempts,
    public.shop_supplier_dispatch_events TO service_role;

CREATE OR REPLACE FUNCTION public.shop_supplier_dispatch_immutable_v2() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.intent_id IS DISTINCT FROM OLD.intent_id
        OR NEW.supplier_account_id IS DISTINCT FROM OLD.supplier_account_id
        OR NEW.original_request_id IS DISTINCT FROM OLD.original_request_id
        OR NEW.account_snapshot IS DISTINCT FROM OLD.account_snapshot OR NEW.frozen_request IS DISTINCT FROM OLD.frozen_request
        OR NEW.contract_hash IS DISTINCT FROM OLD.contract_hash OR NEW.evidence_hash IS DISTINCT FROM OLD.evidence_hash
        OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.reconcile_deadline_at IS DISTINCT FROM OLD.reconcile_deadline_at
        OR (OLD.request_started_at IS NOT NULL AND NEW.request_started_at IS DISTINCT FROM OLD.request_started_at) THEN
        RAISE EXCEPTION 'supplier_dispatch_identity_immutable';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_supplier_dispatch_immutable_v2 ON public.shop_supplier_dispatch_attempts;
CREATE TRIGGER tr_supplier_dispatch_immutable_v2 BEFORE UPDATE ON public.shop_supplier_dispatch_attempts
    FOR EACH ROW EXECUTE FUNCTION public.shop_supplier_dispatch_immutable_v2();

-- Native order row is locked first by ALL dispatch actions. Refund paths already
-- update that row; its version increment makes stale RR snapshots serialize-fail.
-- Even definitive rejection retains exposure in P2C: a later dedicated resolution
-- transaction must implement/refund/release it. Ordinary refund/close is blocked.
CREATE OR REPLACE FUNCTION public.shop_supplier_dispatch_native_guard_v2() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_changed BOOLEAN;
BEGIN
    IF OLD.fulfillment_source IS DISTINCT FROM 'supplier_v2' THEN RETURN NEW; END IF;
    IF TG_TABLE_NAME = 'shop_orders' THEN
        v_changed := NEW.refund_status IS DISTINCT FROM OLD.refund_status
            OR NEW.delivery_status IS DISTINCT FROM OLD.delivery_status
            OR NEW.price_paid IS DISTINCT FROM OLD.price_paid OR NEW.total_price IS DISTINCT FROM OLD.total_price
            OR NEW.item_count IS DISTINCT FROM OLD.item_count OR NEW.user_id IS DISTINCT FROM OLD.user_id
            OR NEW.discount_code IS DISTINCT FROM OLD.discount_code OR NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
            OR NEW.discount_refund_amount IS DISTINCT FROM OLD.discount_refund_amount;
    ELSE
        v_changed := NEW.refund_status IS DISTINCT FROM OLD.refund_status
            OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
            OR NEW.fulfillment_status IS DISTINCT FROM OLD.fulfillment_status
            OR NEW.total_amount IS DISTINCT FROM OLD.total_amount OR NEW.unit_amount IS DISTINCT FROM OLD.unit_amount
            OR NEW.payment_fee_amount IS DISTINCT FROM OLD.payment_fee_amount OR NEW.quantity IS DISTINCT FROM OLD.quantity
            OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.paid_at IS DISTINCT FROM OLD.paid_at;
    END IF;
    IF v_changed AND EXISTS (SELECT 1 FROM public.shop_supplier_dispatch_attempts a
        JOIN public.shop_supplier_procurement_intents i ON i.id = a.intent_id
        JOIN public.shop_supplier_fulfillment_units u ON u.id = i.unit_id
        WHERE (TG_TABLE_NAME = 'shop_orders' AND u.shop_order_id = OLD.id)
            OR (TG_TABLE_NAME = 'guest_shop_orders' AND u.guest_order_id = OLD.id)) THEN
        RAISE EXCEPTION 'supplier_dispatch_resolution_required';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_shop_supplier_dispatch_native_guard_v2 ON public.shop_orders;
CREATE TRIGGER tr_shop_supplier_dispatch_native_guard_v2 BEFORE UPDATE ON public.shop_orders
    FOR EACH ROW EXECUTE FUNCTION public.shop_supplier_dispatch_native_guard_v2();
DROP TRIGGER IF EXISTS tr_guest_supplier_dispatch_native_guard_v2 ON public.guest_shop_orders;
CREATE TRIGGER tr_guest_supplier_dispatch_native_guard_v2 BEFORE UPDATE ON public.guest_shop_orders
    FOR EACH ROW EXECUTE FUNCTION public.shop_supplier_dispatch_native_guard_v2();

CREATE OR REPLACE FUNCTION public.shop_supplier_dispatch_ticket_v2(p_attempt public.shop_supplier_dispatch_attempts)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT jsonb_build_object('intentId', (p_attempt).intent_id, 'attemptId', (p_attempt).id, 'token', (p_attempt).lease_token,
        'account', (p_attempt).account_snapshot, 'contractHash', (p_attempt).contract_hash, 'evidenceHash', (p_attempt).evidence_hash,
        'request', (p_attempt).frozen_request, 'orderNo', (p_attempt).supplier_order_no);
$$;

CREATE OR REPLACE FUNCTION public.fn_shop_supplier_dispatch_v2(
    p_action TEXT, p_intent_id UUID, p_contract_hash TEXT DEFAULT NULL,
    p_token UUID DEFAULT NULL, p_result JSONB DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_unit public.shop_supplier_fulfillment_units%ROWTYPE;
    v_intent public.shop_supplier_procurement_intents%ROWTYPE;
    v_attempt public.shop_supplier_dispatch_attempts%ROWTYPE;
    v_event public.shop_supplier_dispatch_events%ROWTYPE;
    v_policy public.shop_supplier_transaction_policies%ROWTYPE;
    v_mapping public.shop_supplier_product_mappings%ROWTYPE;
    v_account public.shop_supplier_accounts%ROWTYPE;
    v_proof public.shop_supplier_dispatch_verifications%ROWTYPE;
    v_order public.shop_orders%ROWTYPE;
    v_guest public.guest_shop_orders%ROWTYPE;
    v_now TIMESTAMPTZ;
    v_native_ready BOOLEAN := false;
    v_token UUID;
    v_token_hash TEXT;
    v_result_hash TEXT;
    v_request JSONB;
    v_response JSONB;
    v_expected JSONB;
    v_state TEXT;
    v_outbox TEXT;
    v_reason TEXT;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'supplier_service_role_required'; END IF;
    IF p_intent_id IS NULL OR p_action IS NULL OR p_action NOT IN ('prepare', 'begin', 'claim_query', 'record') THEN
        RAISE EXCEPTION 'supplier_dispatch_invalid_request';
    END IF;
    IF p_action <> 'record' AND p_contract_hash IS DISTINCT FROM '4b6dbbf3491c950baeb4860d85128dcd2493ff4a1d61490a0c02892864fb9cae' THEN
        RAISE EXCEPTION 'supplier_dispatch_contract_unverified';
    END IF;
    IF p_action IN ('begin', 'record') AND p_token IS NULL THEN RAISE EXCEPTION 'supplier_dispatch_token_required'; END IF;
    -- The first read locates the native owner WITHOUT a lock. Lock order is
    -- native order -> funding unit -> account policy -> intent -> attempt.
    SELECT u.* INTO v_unit FROM public.shop_supplier_fulfillment_units u
        JOIN public.shop_supplier_procurement_intents i ON i.unit_id = u.id WHERE i.id = p_intent_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'supplier_dispatch_intent_missing'; END IF;
    IF v_unit.funding_kind = 'points' THEN
        SELECT * INTO STRICT v_order FROM public.shop_orders WHERE id = v_unit.shop_order_id FOR UPDATE;
        v_native_ready := v_order.fulfillment_source = 'supplier_v2' AND v_order.delivery_status = 'pending'
            AND COALESCE(v_order.refund_status, 'none') = 'none' AND v_order.item_count = 1
            AND v_order.site = v_unit.site AND v_order.product_id = v_unit.product_id AND v_order.sku_id = v_unit.sku_id
            AND v_order.user_id = v_unit.buyer_user_id AND v_order.price_paid = v_unit.sale_amount
            AND COALESCE(v_order.discount_amount, 0) = 0 AND COALESCE(v_order.discount_refund_amount, 0) = 0
            AND v_order.delivery_completed_at IS NULL AND v_order.inventory_id IS NULL AND v_order.delivery_task_id IS NULL;
    ELSE
        SELECT * INTO STRICT v_guest FROM public.guest_shop_orders WHERE id = v_unit.guest_order_id FOR UPDATE;
        v_native_ready := v_guest.fulfillment_source = 'supplier_v2' AND v_guest.payment_status = 'confirmed'
            AND v_guest.fulfillment_status = 'pending' AND v_guest.refund_status = 'none'
            AND v_guest.reservation_status = 'none' AND v_guest.paid_at IS NOT NULL AND v_guest.fulfilled_at IS NULL
            AND v_guest.site = v_unit.site AND v_guest.product_id = v_unit.product_id AND v_guest.sku_id = v_unit.sku_id
            AND v_guest.currency = 'CNY' AND v_guest.quantity = 1 AND v_guest.unit_amount = v_unit.sale_amount
            AND v_guest.total_amount - COALESCE(v_guest.payment_fee_amount, 0) = v_unit.sale_amount;
    END IF;
    SELECT * INTO STRICT v_unit FROM public.shop_supplier_fulfillment_units WHERE id = v_unit.id FOR UPDATE;
    SELECT * INTO STRICT v_policy FROM public.shop_supplier_transaction_policies
        WHERE supplier_account_id = v_unit.supplier_account_id FOR UPDATE;
    SELECT * INTO STRICT v_intent FROM public.shop_supplier_procurement_intents WHERE id = p_intent_id FOR UPDATE;
    SELECT * INTO v_attempt FROM public.shop_supplier_dispatch_attempts WHERE intent_id = p_intent_id FOR UPDATE;
    v_now := clock_timestamp();
    IF v_intent.supplier_account_id IS DISTINCT FROM v_unit.supplier_account_id THEN
        RAISE EXCEPTION 'supplier_dispatch_identity_conflict';
    END IF;

    -- Abandoned preparation must not remain retryable forever. It has sent no
    -- HTTP request, but still needs the later dedicated resolution transaction.
    -- Retire it even if intake/proof has since been disabled; begin cannot send.
    IF v_attempt.id IS NOT NULL AND v_attempt.state = 'prepared' AND v_attempt.reconcile_deadline_at <= v_now THEN
        UPDATE public.shop_supplier_dispatch_attempts SET state = 'review', lease_kind = 'none', lease_token = NULL,
            lease_expires_at = NULL, updated_at = v_now WHERE id = v_attempt.id;
        UPDATE public.shop_supplier_procurement_intents SET status = 'review' WHERE id = v_intent.id;
        UPDATE public.shop_supplier_transaction_outbox SET status = 'review', block_reason = 'reconciliation_exhausted'
            WHERE intent_id = v_intent.id;
        v_response := jsonb_build_object('status', 'review', 'applied', true, 'acquired', false);
        INSERT INTO public.shop_supplier_dispatch_events(attempt_id, event_type, token_hash, response)
            VALUES (v_attempt.id, 'review', encode(sha256(convert_to(v_attempt.id::TEXT, 'UTF8')), 'hex'), v_response);
        RETURN v_response;
    END IF;

    IF p_action IN ('prepare', 'begin') THEN
        IF (p_action = 'prepare' AND v_intent.status NOT IN ('not_submitted', 'prepared'))
            OR (p_action = 'begin' AND (v_attempt.id IS NULL OR v_attempt.state <> 'prepared'
                OR v_attempt.lease_token IS DISTINCT FROM p_token OR v_attempt.lease_expires_at <= v_now
                OR v_attempt.reconcile_deadline_at <= v_now)) THEN
            RETURN jsonb_build_object('status', v_intent.status, 'applied', false, 'acquired', false);
        END IF;
        IF NOT COALESCE(v_native_ready, false) OR v_unit.funding_state <> 'funded'
            OR v_unit.site <> 'cn' OR v_unit.quantity <> 1 OR v_intent.exposure_status <> 'held'
            OR v_intent.reserved_cost_cny IS DISTINCT FROM v_unit.cost_ceiling_cny
            OR NOT v_policy.intake_enabled OR NOT v_policy.checkout_enabled OR NOT v_policy.dispatch_enabled
            OR v_unit.cost_ceiling_cny > v_policy.per_unit_cost_ceiling_cny THEN
            RETURN jsonb_build_object('status', 'blocked', 'applied', false, 'acquired', false);
        END IF;
        SELECT * INTO v_mapping FROM public.shop_supplier_product_mappings WHERE id = v_unit.mapping_id FOR SHARE;
        IF NOT FOUND OR NOT v_mapping.is_enabled OR NOT v_mapping.is_primary OR v_mapping.contract_version <> 2
            OR v_mapping.site IS DISTINCT FROM v_unit.site OR v_mapping.supplier_account_id IS DISTINCT FROM v_unit.supplier_account_id
            OR v_mapping.product_id IS DISTINCT FROM v_unit.product_id OR v_mapping.sku_id IS DISTINCT FROM v_unit.sku_id
            OR v_mapping.updated_at IS DISTINCT FROM v_unit.mapping_revision
            OR v_mapping.supplier_goods_no IS DISTINCT FROM v_unit.source_snapshot->>'goods_no'
            OR v_mapping.supplier_variant IS DISTINCT FROM v_unit.source_snapshot->'variant'
            OR v_mapping.supplier_variant_key IS DISTINCT FROM v_unit.source_snapshot->>'variant_key' THEN
            RETURN jsonb_build_object('status', 'blocked', 'applied', false, 'acquired', false);
        END IF;
        SELECT * INTO v_account FROM public.shop_supplier_accounts WHERE id = v_unit.supplier_account_id FOR SHARE;
        IF NOT FOUND OR NOT v_account.is_enabled OR v_account.provider_id IS DISTINCT FROM v_unit.source_snapshot->>'provider_id' THEN
            RETURN jsonb_build_object('status', 'blocked', 'applied', false, 'acquired', false);
        END IF;
        SELECT * INTO v_proof FROM public.shop_supplier_dispatch_verifications WHERE supplier_account_id = v_account.id FOR SHARE;
        IF NOT FOUND OR NOT v_proof.is_enabled OR v_proof.verified_at > clock_timestamp() OR v_proof.expires_at <= clock_timestamp()
            OR v_proof.provider_id IS DISTINCT FROM v_account.provider_id OR v_proof.credential_ref IS DISTINCT FROM v_account.credential_ref
            OR v_proof.contract_hash IS DISTINCT FROM p_contract_hash OR NOT v_proof.request_lookup_verified
            OR NOT v_proof.immutable_request_key_verified OR NOT v_proof.final_rejection_verified OR NOT v_proof.atomic_cny_ceiling_verified THEN
            RETURN jsonb_build_object('status', 'blocked', 'applied', false, 'acquired', false);
        END IF;
        v_request := jsonb_build_object('requestId', v_intent.original_request_id, 'goodsNo', v_mapping.supplier_goods_no,
            'variant', v_mapping.supplier_variant, 'quantity', 1,
            'maxCost', jsonb_build_object('currency', 'CNY', 'amount', v_unit.cost_ceiling_cny::TEXT));
        IF v_attempt.id IS NOT NULL AND (v_attempt.frozen_request IS DISTINCT FROM v_request
            OR v_attempt.contract_hash IS DISTINCT FROM v_proof.contract_hash OR v_attempt.evidence_hash IS DISTINCT FROM v_proof.evidence_hash
            OR v_attempt.account_snapshot IS DISTINCT FROM jsonb_build_object('id', v_account.id,
                'provider_id', v_account.provider_id, 'credential_ref', v_account.credential_ref)) THEN
            RAISE EXCEPTION 'supplier_dispatch_identity_conflict';
        END IF;
        v_now := clock_timestamp();
        IF p_action = 'prepare' THEN
            IF v_attempt.id IS NOT NULL AND v_attempt.lease_expires_at > v_now THEN
                RETURN jsonb_build_object('status', 'prepared', 'applied', false, 'acquired', false);
            END IF;
            v_token := gen_random_uuid();
            IF v_attempt.id IS NULL THEN
                INSERT INTO public.shop_supplier_dispatch_attempts(intent_id, supplier_account_id, original_request_id,
                    account_snapshot, frozen_request, contract_hash, evidence_hash, state, lease_kind, lease_token,
                    lease_expires_at, reconcile_deadline_at)
                VALUES (v_intent.id, v_account.id, v_intent.original_request_id,
                    jsonb_build_object('id', v_account.id, 'provider_id', v_account.provider_id, 'credential_ref', v_account.credential_ref),
                    v_request, v_proof.contract_hash, v_proof.evidence_hash, 'prepared', 'prepare', v_token,
                    v_now + INTERVAL '30 seconds', v_now + INTERVAL '24 hours') RETURNING * INTO v_attempt;
            ELSE
                UPDATE public.shop_supplier_dispatch_attempts SET lease_token = v_token,
                    lease_expires_at = v_now + INTERVAL '30 seconds', updated_at = v_now
                    WHERE id = v_attempt.id RETURNING * INTO v_attempt;
            END IF;
            UPDATE public.shop_supplier_procurement_intents SET status = 'prepared' WHERE id = v_intent.id;
            UPDATE public.shop_supplier_transaction_outbox SET status = 'processing', block_reason = 'dispatch_in_progress'
                WHERE intent_id = v_intent.id;
            v_response := jsonb_build_object('status', 'prepared', 'applied', true, 'acquired', true);
        ELSE
            -- No replay branch can return applied=true for begin. A lost ACK
            -- deliberately sacrifices automatic progress rather than send twice.
            IF v_attempt.lease_expires_at <= v_now THEN
                RETURN jsonb_build_object('status', 'prepared', 'applied', false, 'acquired', false);
            END IF;
            v_token := p_token;
            UPDATE public.shop_supplier_dispatch_attempts SET state = 'dispatching', lease_kind = 'dispatch',
                request_started_at = v_now, lease_expires_at = v_now + INTERVAL '120 seconds',
                next_query_at = v_now + INTERVAL '120 seconds', updated_at = v_now
                WHERE id = v_attempt.id RETURNING * INTO v_attempt;
            UPDATE public.shop_supplier_procurement_intents SET status = 'dispatching' WHERE id = v_intent.id;
            v_response := jsonb_build_object('status', 'dispatching', 'applied', true, 'acquired', false);
        END IF;
        -- Native row version is changed in the SAME transaction as authorization.
        IF v_unit.funding_kind = 'points' THEN
            UPDATE public.shop_orders SET supplier_dispatch_version = supplier_dispatch_version + 1 WHERE id = v_order.id;
        ELSE
            UPDATE public.guest_shop_orders SET supplier_dispatch_version = supplier_dispatch_version + 1 WHERE id = v_guest.id;
        END IF;
        INSERT INTO public.shop_supplier_dispatch_events(attempt_id, event_type, token_hash, response)
            VALUES (v_attempt.id, p_action, encode(sha256(convert_to(v_token::TEXT, 'UTF8')), 'hex'), v_response);
        RETURN v_response || jsonb_build_object('ticket', public.shop_supplier_dispatch_ticket_v2(v_attempt));
    END IF;

    -- Recovery uses ONLY the frozen account/request/verification. Turning off
    -- new intake/dispatch, disabling a mapping, or proof expiry cannot block it.
    IF v_attempt.id IS NULL THEN
        RETURN jsonb_build_object('status', 'blocked', 'applied', false, 'acquired', false);
    END IF;
    IF p_action = 'record' THEN
        IF p_result IS NULL OR jsonb_typeof(p_result) IS DISTINCT FROM 'object'
            OR p_result->>'requestId' IS DISTINCT FROM v_intent.original_request_id::TEXT THEN
            RAISE EXCEPTION 'supplier_dispatch_invalid_result';
        END IF;
        IF p_result->>'outcome' = 'accepted' THEN
            IF p_result->>'orderNo' IS NULL OR p_result->>'orderNo' !~ '^[[:alnum:]_.:-]{1,160}$'
                OR p_result->>'evidenceHash' IS NULL OR p_result->>'evidenceHash' !~ '^[a-f0-9]{64}$' THEN
                RAISE EXCEPTION 'supplier_dispatch_invalid_result';
            END IF;
            v_expected := jsonb_build_object('outcome', 'accepted', 'requestId', v_intent.original_request_id,
                'orderNo', p_result->>'orderNo', 'evidenceHash', p_result->>'evidenceHash', 'code', 'accepted');
        ELSIF p_result->>'outcome' = 'rejected' THEN
            IF p_result->>'evidenceHash' IS NULL OR p_result->>'evidenceHash' !~ '^[a-f0-9]{64}$' THEN
                RAISE EXCEPTION 'supplier_dispatch_invalid_result';
            END IF;
            v_expected := jsonb_build_object('outcome', 'rejected', 'requestId', v_intent.original_request_id,
                'evidenceHash', p_result->>'evidenceHash', 'code', 'explicitly_not_accepted');
        ELSIF p_result->>'outcome' = 'unknown' AND p_result->>'code' IN ('not_found', 'outcome_unknown') THEN
            v_expected := jsonb_build_object('outcome', 'unknown', 'requestId', v_intent.original_request_id, 'code', p_result->>'code');
        ELSE RAISE EXCEPTION 'supplier_dispatch_invalid_result'; END IF;
        -- Reject arbitrary fields, provider messages, numeric costs and secrets.
        IF p_result IS DISTINCT FROM v_expected THEN RAISE EXCEPTION 'supplier_dispatch_invalid_result'; END IF;
        v_token_hash := encode(sha256(convert_to(p_token::TEXT, 'UTF8')), 'hex');
        v_result_hash := encode(sha256(convert_to(p_result::TEXT, 'UTF8')), 'hex');
        SELECT * INTO v_event FROM public.shop_supplier_dispatch_events
            WHERE attempt_id = v_attempt.id AND event_type = 'result' AND token_hash = v_token_hash;
        IF FOUND THEN
            IF v_event.result_hash IS DISTINCT FROM v_result_hash THEN RAISE EXCEPTION 'supplier_dispatch_result_conflict'; END IF;
            RETURN v_event.response;
        END IF;
        IF v_attempt.lease_token IS DISTINCT FROM p_token OR v_attempt.lease_kind NOT IN ('dispatch', 'query')
            OR v_attempt.state NOT IN ('dispatching', 'outcome_unknown') THEN
            RETURN jsonb_build_object('status', v_attempt.state, 'applied', false, 'acquired', false);
        END IF;
    END IF;
    v_now := clock_timestamp();
    IF v_attempt.state IN ('accepted', 'rejected', 'review', 'prepared') THEN
        RETURN jsonb_build_object('status', v_attempt.state, 'applied', false, 'acquired', false);
    END IF;
    IF v_attempt.lease_kind <> 'none' AND v_attempt.lease_expires_at <= v_now THEN
        INSERT INTO public.shop_supplier_dispatch_events(attempt_id, event_type, token_hash, response)
            VALUES (v_attempt.id, 'expired', encode(sha256(convert_to(v_attempt.lease_token::TEXT, 'UTF8')), 'hex'),
                jsonb_build_object('status', 'outcome_unknown', 'applied', true, 'acquired', false));
        UPDATE public.shop_supplier_dispatch_attempts SET state = 'outcome_unknown', lease_kind = 'none',
            lease_token = NULL, lease_expires_at = NULL, updated_at = v_now
            WHERE id = v_attempt.id RETURNING * INTO v_attempt;
        UPDATE public.shop_supplier_procurement_intents SET status = 'outcome_unknown' WHERE id = v_intent.id;
        UPDATE public.shop_supplier_transaction_outbox SET status = 'awaiting_reconciliation', block_reason = 'outcome_unknown'
            WHERE intent_id = v_intent.id;
    END IF;
    IF p_action = 'claim_query' THEN
        IF v_attempt.lease_kind <> 'none' OR v_attempt.next_query_at > v_now THEN
            RETURN jsonb_build_object('status', v_attempt.state, 'applied', false, 'acquired', false);
        END IF;
        IF v_attempt.query_count >= 12 OR v_attempt.reconcile_deadline_at <= v_now THEN
            UPDATE public.shop_supplier_dispatch_attempts SET state = 'review', updated_at = v_now WHERE id = v_attempt.id;
            UPDATE public.shop_supplier_procurement_intents SET status = 'review' WHERE id = v_intent.id;
            UPDATE public.shop_supplier_transaction_outbox SET status = 'review', block_reason = 'reconciliation_exhausted'
                WHERE intent_id = v_intent.id;
            v_response := jsonb_build_object('status', 'review', 'applied', true, 'acquired', false);
            INSERT INTO public.shop_supplier_dispatch_events(attempt_id, event_type, token_hash, response)
                VALUES (v_attempt.id, 'review', encode(sha256(convert_to(v_attempt.id::TEXT, 'UTF8')), 'hex'), v_response);
            RETURN v_response;
        END IF;
        v_token := gen_random_uuid();
        UPDATE public.shop_supplier_dispatch_attempts SET state = 'outcome_unknown', lease_kind = 'query', lease_token = v_token,
            lease_expires_at = v_now + INTERVAL '60 seconds', query_count = query_count + 1,
            next_query_at = v_now + make_interval(secs => LEAST(3600, 30 * power(2, query_count)::INTEGER)), updated_at = v_now
            WHERE id = v_attempt.id RETURNING * INTO v_attempt;
        UPDATE public.shop_supplier_procurement_intents SET status = 'outcome_unknown' WHERE id = v_intent.id;
        UPDATE public.shop_supplier_transaction_outbox SET status = 'awaiting_reconciliation', block_reason = 'outcome_unknown'
            WHERE intent_id = v_intent.id;
        v_response := jsonb_build_object('status', 'outcome_unknown', 'applied', true, 'acquired', true);
        INSERT INTO public.shop_supplier_dispatch_events(attempt_id, event_type, token_hash, response)
            VALUES (v_attempt.id, 'claim_query', encode(sha256(convert_to(v_token::TEXT, 'UTF8')), 'hex'), v_response);
        RETURN v_response || jsonb_build_object('ticket', public.shop_supplier_dispatch_ticket_v2(v_attempt));
    END IF;
    -- An expired/later query token must never apply a late create/query result.
    IF v_attempt.lease_token IS DISTINCT FROM p_token OR v_attempt.lease_expires_at <= v_now THEN
        RETURN jsonb_build_object('status', v_attempt.state, 'applied', false, 'acquired', false);
    END IF;
    v_state := CASE p_result->>'outcome' WHEN 'accepted' THEN 'accepted' WHEN 'rejected' THEN 'rejected' ELSE 'outcome_unknown' END;
    IF v_state = 'accepted' AND EXISTS (SELECT 1 FROM public.shop_supplier_procurement_intents
        WHERE supplier_account_id = v_intent.supplier_account_id AND supplier_order_no = p_result->>'orderNo' AND id <> v_intent.id) THEN
        v_state := 'review';
    END IF;
    v_outbox := CASE v_state WHEN 'accepted' THEN 'awaiting_delivery' WHEN 'rejected' THEN 'rejected'
        WHEN 'review' THEN 'review' ELSE 'awaiting_reconciliation' END;
    v_reason := CASE v_state WHEN 'accepted' THEN 'supplier_accepted' WHEN 'rejected' THEN 'supplier_rejected'
        WHEN 'review' THEN 'reconciliation_exhausted' ELSE 'outcome_unknown' END;
    UPDATE public.shop_supplier_dispatch_attempts SET state = v_state, lease_kind = 'none', lease_token = NULL,
        lease_expires_at = NULL, supplier_order_no = CASE WHEN v_state = 'accepted' THEN p_result->>'orderNo' END,
        updated_at = v_now WHERE id = v_attempt.id;
    UPDATE public.shop_supplier_procurement_intents SET status = v_state,
        supplier_order_no = CASE WHEN v_state = 'accepted' THEN p_result->>'orderNo' END WHERE id = v_intent.id;
    UPDATE public.shop_supplier_transaction_outbox SET status = v_outbox, block_reason = v_reason WHERE intent_id = v_intent.id;
    v_response := jsonb_build_object('status', v_state, 'applied', true, 'acquired', false);
    INSERT INTO public.shop_supplier_dispatch_events(attempt_id, event_type, token_hash, result_hash, result, response)
        VALUES (v_attempt.id, 'result', v_token_hash, v_result_hash, p_result, v_response);
    -- No budget release, cost, refund, points, delivery or marketing write here.
    RETURN v_response;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_shop_supplier_dispatch_v2(TEXT, UUID, TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_shop_supplier_dispatch_v2(TEXT, UUID, TEXT, UUID, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.shop_supplier_dispatch_ticket_v2(public.shop_supplier_dispatch_attempts),
    public.shop_supplier_dispatch_immutable_v2(), public.shop_supplier_dispatch_native_guard_v2()
    FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE public.shop_supplier_dispatch_attempts IS
    'P2C one durable attempt per intent. Frozen original request/account; begin authorizes at most one create; unknown is query-only. No delivery/refund executor.';
COMMENT ON TABLE public.shop_supplier_transaction_outbox IS
    'P2C default-off supplier dispatch journal projection. No automatic worker installed. Accepted awaits separate verified delivery; all exposure remains held.';
COMMENT ON FUNCTION public.fn_shop_supplier_dispatch_v2(TEXT, UUID, TEXT, UUID, JSONB) IS
    'Private P2C prepare/begin/claim_query/record. Proof and policy gated, one original request, fenced query-only recovery, sanitized append-only evidence. Not a merchant or concurrency acceptance result.';
NOTIFY pgrst, 'reload schema';
COMMIT;
