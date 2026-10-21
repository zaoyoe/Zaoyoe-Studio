-- P2D-1: verified delivery + actual cost. Apply manually AFTER P2C.
-- Installs no proof rows, worker, route to a merchant, timer or enabled switch.
-- Refund/exceptional close remains blocked until its own resolution protocol.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$
BEGIN
    IF to_regprocedure('public.fn_shop_supplier_dispatch_v2(text,uuid,text,uuid,jsonb)') IS NULL
        OR to_regprocedure('public.shop_supplier_native_order_guard_v2()') IS NULL THEN
        RAISE EXCEPTION 'Supplier P2B/P2C migrations are required before P2D-1';
    END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.shop_supplier_delivery_verifications (
    supplier_account_id UUID PRIMARY KEY REFERENCES public.shop_supplier_accounts(id) ON DELETE RESTRICT,
    provider_id TEXT NOT NULL CHECK (provider_id ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
    credential_ref TEXT NOT NULL CHECK (credential_ref ~ '^env:[A-Z][A-Z0-9_]{0,119}$'),
    contract_hash TEXT NOT NULL CHECK (contract_hash = '412c6c9277c684368548010f93001c9cf10a7b170fddcafc085f9a0171289fd9'),
    evidence_hash TEXT NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
    verified_at TIMESTAMPTZ NOT NULL,
    valid_until TIMESTAMPTZ NOT NULL CHECK (valid_until > verified_at)
);
CREATE TABLE IF NOT EXISTS public.shop_supplier_delivery_receipts (
    unit_id UUID PRIMARY KEY REFERENCES public.shop_supplier_fulfillment_units(id) ON DELETE RESTRICT,
    intent_id UUID NOT NULL UNIQUE REFERENCES public.shop_supplier_procurement_intents(id) ON DELETE RESTRICT,
    supplier_account_id UUID NOT NULL REFERENCES public.shop_supplier_accounts(id) ON DELETE RESTRICT,
    original_request_id UUID NOT NULL,
    supplier_order_no TEXT NOT NULL CHECK (supplier_order_no ~ '^[[:alnum:]_.:-]{1,160}$'),
    contract_hash TEXT NOT NULL CHECK (contract_hash = '412c6c9277c684368548010f93001c9cf10a7b170fddcafc085f9a0171289fd9'),
    proof_hash TEXT NOT NULL CHECK (proof_hash ~ '^[a-f0-9]{64}$'),
    evidence_hash TEXT NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
    result_hash TEXT NOT NULL CHECK (result_hash ~ '^[a-f0-9]{64}$'),
    actual_cost_cny NUMERIC(18,6) NOT NULL CHECK (actual_cost_cny >= 0 AND actual_cost_cny <> 'NaN'::NUMERIC),
    content_fingerprint TEXT NOT NULL CHECK (content_fingerprint ~ '^[a-f0-9]{64}$'),
    sealed JSONB NOT NULL CONSTRAINT shop_supplier_delivery_sealed_check CHECK (COALESCE(
        jsonb_typeof(sealed) = 'object'
        AND sealed - ARRAY['version','algorithm','keyId','nonce','ciphertext','tag','fingerprint'] = '{}'::JSONB
        AND sealed ?& ARRAY['version','algorithm','keyId','nonce','ciphertext','tag','fingerprint']
        AND sealed->'version' = '1'::JSONB AND sealed->>'algorithm' = 'aes-256-gcm'
        AND jsonb_typeof(sealed->'algorithm') = 'string' AND jsonb_typeof(sealed->'keyId') = 'string'
        AND jsonb_typeof(sealed->'nonce') = 'string' AND jsonb_typeof(sealed->'tag') = 'string'
        AND jsonb_typeof(sealed->'ciphertext') = 'string' AND jsonb_typeof(sealed->'fingerprint') = 'string'
        AND sealed->>'keyId' ~ '^[a-zA-Z0-9_-]{1,40}$'
        AND sealed->>'nonce' ~ '^[A-Za-z0-9+/]{16}$'
        AND sealed->>'tag' ~ '^[A-Za-z0-9+/]{22}==$'
        AND sealed->>'ciphertext' ~ '^[A-Za-z0-9+/]+={0,2}$'
        AND octet_length(sealed->>'ciphertext') BETWEEN 4 AND 43692
        AND octet_length(decode(sealed->>'ciphertext','base64')) BETWEEN 1 AND 32768
        AND replace(encode(decode(sealed->>'ciphertext','base64'),'base64'),chr(10),'') = sealed->>'ciphertext'
        AND encode(decode(sealed->>'tag','base64'),'base64') = sealed->>'tag'
        AND sealed->>'fingerprint' = content_fingerprint, false)),
    disposition TEXT NOT NULL CHECK (disposition IN ('delivered', 'quarantined')),
    quarantine_reason TEXT CHECK (quarantine_reason IN ('native_not_deliverable','cost_above_ceiling','duplicate_content')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (supplier_account_id, original_request_id),
    UNIQUE (supplier_account_id, supplier_order_no),
    CHECK ((disposition = 'delivered' AND quarantine_reason IS NULL)
        OR (disposition = 'quarantined' AND quarantine_reason IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_delivery_content_owner_v2
    ON public.shop_supplier_delivery_receipts(content_fingerprint) WHERE disposition = 'delivered';
ALTER TABLE public.shop_supplier_delivery_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_supplier_delivery_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_supplier_delivery_verifications, public.shop_supplier_delivery_receipts
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.shop_supplier_delivery_verifications, public.shop_supplier_delivery_receipts TO service_role;
CREATE OR REPLACE FUNCTION public.shop_supplier_delivery_receipt_immutable_v2() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    RAISE EXCEPTION 'supplier_delivery_receipt_immutable';
END;
$$;
DROP TRIGGER IF EXISTS tr_supplier_delivery_receipt_immutable_v2 ON public.shop_supplier_delivery_receipts;
CREATE TRIGGER tr_supplier_delivery_receipt_immutable_v2 BEFORE UPDATE OR DELETE ON public.shop_supplier_delivery_receipts
    FOR EACH ROW EXECUTE FUNCTION public.shop_supplier_delivery_receipt_immutable_v2();

ALTER TABLE public.shop_supplier_procurement_intents DROP CONSTRAINT IF EXISTS shop_supplier_intent_unsubmitted_check;
ALTER TABLE public.shop_supplier_procurement_intents ADD CONSTRAINT shop_supplier_intent_unsubmitted_check CHECK (
    (status = 'accepted' AND supplier_order_no IS NOT NULL
        AND (actual_cost_cny IS NULL OR (actual_cost_cny >= 0 AND actual_cost_cny <> 'NaN'::NUMERIC)))
    OR (status <> 'accepted' AND supplier_order_no IS NULL AND actual_cost_cny IS NULL)
);
-- Keep dispatch states stable for old runners. Completion is represented by the
-- immutable receipt, with a terminal outbox state and a settled reservation.
ALTER TABLE public.shop_supplier_transaction_outbox DROP CONSTRAINT IF EXISTS shop_supplier_outbox_status_check;
ALTER TABLE public.shop_supplier_transaction_outbox ADD CONSTRAINT shop_supplier_outbox_status_check CHECK (
    status IN ('blocked','processing','awaiting_reconciliation','awaiting_delivery','rejected','review','completed'));
ALTER TABLE public.shop_supplier_transaction_outbox DROP CONSTRAINT IF EXISTS shop_supplier_transaction_outbox_block_reason_check;
ALTER TABLE public.shop_supplier_transaction_outbox ADD CONSTRAINT shop_supplier_transaction_outbox_block_reason_check CHECK (
    block_reason IN ('procurement_contract_unverified','risk_budget_unavailable','customer_resolution_required',
        'dispatch_in_progress','outcome_unknown','supplier_accepted','supplier_rejected','reconciliation_exhausted',
        'supplier_delivered','delivery_quarantined'));

CREATE OR REPLACE FUNCTION public.fn_shop_supplier_delivery_ticket_v2(p_intent_id UUID, p_contract_hash TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_unit public.shop_supplier_fulfillment_units%ROWTYPE;
    v_intent public.shop_supplier_procurement_intents%ROWTYPE;
    v_attempt public.shop_supplier_dispatch_attempts%ROWTYPE;
    v_proof public.shop_supplier_delivery_verifications%ROWTYPE;
    v_receipt public.shop_supplier_delivery_receipts%ROWTYPE;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'supplier_service_role_required'; END IF;
    IF p_intent_id IS NULL OR p_contract_hash IS DISTINCT FROM '412c6c9277c684368548010f93001c9cf10a7b170fddcafc085f9a0171289fd9' THEN
        RAISE EXCEPTION 'supplier_delivery_contract_unverified';
    END IF;
    SELECT * INTO STRICT v_intent FROM public.shop_supplier_procurement_intents WHERE id = p_intent_id;
    SELECT * INTO v_receipt FROM public.shop_supplier_delivery_receipts WHERE intent_id = p_intent_id;
    IF FOUND THEN RETURN jsonb_build_object('status', v_receipt.disposition); END IF;
    SELECT * INTO STRICT v_unit FROM public.shop_supplier_fulfillment_units WHERE id = v_intent.unit_id;
    SELECT * INTO v_attempt FROM public.shop_supplier_dispatch_attempts WHERE intent_id = p_intent_id;
    IF v_intent.status <> 'accepted' OR v_attempt.state IS DISTINCT FROM 'accepted' THEN
        RETURN jsonb_build_object('status', 'awaiting_acceptance');
    END IF;
    SELECT * INTO v_proof FROM public.shop_supplier_delivery_verifications WHERE supplier_account_id = v_unit.supplier_account_id;
    IF v_proof.supplier_account_id IS NULL OR v_proof.contract_hash IS DISTINCT FROM p_contract_hash
        OR v_proof.provider_id IS DISTINCT FROM v_attempt.account_snapshot->>'provider_id'
        OR v_proof.credential_ref IS DISTINCT FROM v_attempt.account_snapshot->>'credential_ref'
        OR v_proof.verified_at > clock_timestamp() OR v_proof.valid_until <= clock_timestamp() THEN
        RAISE EXCEPTION 'supplier_delivery_contract_unverified';
    END IF;
    -- Intake switches/account/catalog changes must not redirect recovery of an
    -- already accepted original request to new credentials or a new supplier.
    RETURN jsonb_build_object('status','ready','ticket',jsonb_build_object(
        'intentId',v_intent.id,'unitId',v_unit.id,'site',v_unit.site,'account',v_attempt.account_snapshot,
        'requestId',v_attempt.original_request_id,'orderNo',v_attempt.supplier_order_no,
        'contractHash',v_proof.contract_hash,'proofHash',v_proof.evidence_hash));
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_shop_supplier_record_delivery_v2(p_intent_id UUID, p_receipt JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_unit public.shop_supplier_fulfillment_units%ROWTYPE;
    v_intent public.shop_supplier_procurement_intents%ROWTYPE;
    v_attempt public.shop_supplier_dispatch_attempts%ROWTYPE;
    v_proof public.shop_supplier_delivery_verifications%ROWTYPE;
    v_existing public.shop_supplier_delivery_receipts%ROWTYPE;
    v_order public.shop_orders%ROWTYPE;
    v_guest public.guest_shop_orders%ROWTYPE;
    v_native_ready BOOLEAN := false;
    v_result_hash TEXT;
    v_cost NUMERIC(18,6);
    v_reason TEXT;
    v_now TIMESTAMPTZ;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'supplier_service_role_required'; END IF;
    IF p_intent_id IS NULL OR p_receipt IS NULL OR jsonb_typeof(p_receipt) <> 'object'
        OR p_receipt - ARRAY['requestId','accountId','orderNo','contractHash','proofHash','evidenceHash','actualCostCny','sealed'] <> '{}'::JSONB
        OR NOT p_receipt ?& ARRAY['requestId','accountId','orderNo','contractHash','proofHash','evidenceHash','actualCostCny','sealed']
        OR jsonb_typeof(p_receipt->'actualCostCny') IS DISTINCT FROM 'string'
        OR NOT COALESCE(p_receipt->>'actualCostCny' ~ '^[0-9]{1,12}(\.[0-9]{1,6})?$', false)
        OR jsonb_typeof(p_receipt->'evidenceHash') IS DISTINCT FROM 'string'
        OR NOT COALESCE(p_receipt->>'evidenceHash' ~ '^[a-f0-9]{64}$', false)
        OR jsonb_typeof(p_receipt->'proofHash') IS DISTINCT FROM 'string'
        OR NOT COALESCE(p_receipt->>'proofHash' ~ '^[a-f0-9]{64}$', false)
        OR jsonb_typeof(p_receipt->'sealed') IS DISTINCT FROM 'object'
        OR NOT COALESCE(p_receipt->'sealed'->>'fingerprint' ~ '^[a-f0-9]{64}$', false) THEN
        RAISE EXCEPTION 'supplier_delivery_invalid_receipt';
    END IF;
    v_cost := (p_receipt->>'actualCostCny')::NUMERIC;
    -- Same lock order as dispatch. Never start with a private row lock and then
    -- wait for the native order: existing refund functions lock native first.
    SELECT u.* INTO STRICT v_unit FROM public.shop_supplier_fulfillment_units u
        JOIN public.shop_supplier_procurement_intents i ON i.unit_id = u.id WHERE i.id = p_intent_id;
    IF v_unit.funding_kind = 'points' THEN
        SELECT * INTO STRICT v_order FROM public.shop_orders WHERE id = v_unit.shop_order_id FOR UPDATE;
        v_native_ready := v_order.fulfillment_source = 'supplier_v2' AND v_order.delivery_status = 'pending'
            AND COALESCE(v_order.refund_status,'none') = 'none' AND v_order.item_count = 1
            AND v_order.site = v_unit.site AND v_order.product_id = v_unit.product_id AND v_order.sku_id = v_unit.sku_id
            AND v_order.user_id = v_unit.buyer_user_id AND v_order.price_paid = v_unit.sale_amount
            AND COALESCE(v_order.discount_amount,0) = 0 AND COALESCE(v_order.discount_refund_amount,0) = 0
            AND v_order.delivery_completed_at IS NULL AND v_order.inventory_id IS NULL AND v_order.delivery_task_id IS NULL;
    ELSE
        SELECT * INTO STRICT v_guest FROM public.guest_shop_orders WHERE id = v_unit.guest_order_id FOR UPDATE;
        v_native_ready := v_guest.fulfillment_source = 'supplier_v2' AND v_guest.payment_status = 'confirmed'
            AND v_guest.fulfillment_status = 'pending' AND v_guest.refund_status = 'none'
            AND v_guest.reservation_status = 'none' AND v_guest.paid_at IS NOT NULL AND v_guest.fulfilled_at IS NULL
            AND v_guest.site = v_unit.site AND v_guest.product_id = v_unit.product_id AND v_guest.sku_id = v_unit.sku_id
            AND v_guest.currency = 'CNY' AND v_guest.quantity = 1 AND v_guest.unit_amount = v_unit.sale_amount
            AND v_guest.total_amount - COALESCE(v_guest.payment_fee_amount,0) = v_unit.sale_amount;
    END IF;
    SELECT * INTO STRICT v_unit FROM public.shop_supplier_fulfillment_units WHERE id = v_unit.id FOR UPDATE;
    PERFORM 1 FROM public.shop_supplier_transaction_policies WHERE supplier_account_id = v_unit.supplier_account_id FOR UPDATE;
    SELECT * INTO STRICT v_intent FROM public.shop_supplier_procurement_intents WHERE id = p_intent_id FOR UPDATE;
    SELECT * INTO STRICT v_attempt FROM public.shop_supplier_dispatch_attempts WHERE intent_id = p_intent_id FOR UPDATE;
    v_now := clock_timestamp();
    IF v_unit.funding_state <> 'funded' OR v_intent.status <> 'accepted' OR v_attempt.state <> 'accepted'
        OR v_attempt.request_started_at IS NULL OR v_unit.supplier_account_id IS DISTINCT FROM v_intent.supplier_account_id
        OR v_attempt.supplier_account_id IS DISTINCT FROM v_intent.supplier_account_id
        OR v_attempt.original_request_id IS DISTINCT FROM v_intent.original_request_id
        OR v_attempt.supplier_order_no IS DISTINCT FROM v_intent.supplier_order_no
        OR p_receipt->>'requestId' IS DISTINCT FROM v_intent.original_request_id::TEXT
        OR p_receipt->>'accountId' IS DISTINCT FROM v_intent.supplier_account_id::TEXT
        OR p_receipt->>'orderNo' IS DISTINCT FROM v_intent.supplier_order_no
        OR p_receipt->>'contractHash' IS DISTINCT FROM '412c6c9277c684368548010f93001c9cf10a7b170fddcafc085f9a0171289fd9' THEN
        RAISE EXCEPTION 'supplier_delivery_identity_conflict';
    END IF;
    v_result_hash := encode(sha256(convert_to(jsonb_build_object('request',p_receipt->>'requestId',
        'account',p_receipt->>'accountId','order',p_receipt->>'orderNo','contract',p_receipt->>'contractHash',
        'proof',p_receipt->>'proofHash','evidence',p_receipt->>'evidenceHash','cost',v_cost,
        'content',p_receipt->'sealed'->>'fingerprint')::TEXT,'UTF8')),'hex');
    SELECT * INTO v_existing FROM public.shop_supplier_delivery_receipts WHERE intent_id = p_intent_id;
    IF FOUND THEN
        IF v_existing.result_hash IS DISTINCT FROM v_result_hash THEN RAISE EXCEPTION 'supplier_delivery_result_conflict'; END IF;
        RETURN jsonb_build_object('status',v_existing.disposition,'applied',true,'duplicate',true);
    END IF;
    SELECT * INTO v_proof FROM public.shop_supplier_delivery_verifications
        WHERE supplier_account_id = v_unit.supplier_account_id FOR SHARE;
    IF v_proof.supplier_account_id IS NULL OR v_proof.contract_hash IS DISTINCT FROM p_receipt->>'contractHash'
        OR v_proof.evidence_hash IS DISTINCT FROM p_receipt->>'proofHash'
        OR v_proof.provider_id IS DISTINCT FROM v_attempt.account_snapshot->>'provider_id'
        OR v_proof.credential_ref IS DISTINCT FROM v_attempt.account_snapshot->>'credential_ref'
        OR v_proof.verified_at > v_now OR v_proof.valid_until <= v_now THEN
        RAISE EXCEPTION 'supplier_delivery_contract_unverified';
    END IF;
    -- Serialize ownership of the same plaintext across accounts/orders. Never
    -- reuse another buyer's card, even when it was returned by a different API.
    PERFORM pg_advisory_xact_lock(hashtextextended('supplier-delivery-v1:' || (p_receipt->'sealed'->>'fingerprint'),0));
    IF NOT COALESCE(v_native_ready,false) THEN v_reason := 'native_not_deliverable';
    ELSIF v_cost > v_unit.cost_ceiling_cny THEN v_reason := 'cost_above_ceiling';
    ELSIF EXISTS (SELECT 1 FROM public.shop_supplier_delivery_receipts
        WHERE content_fingerprint = p_receipt->'sealed'->>'fingerprint') THEN v_reason := 'duplicate_content';
    END IF;
    INSERT INTO public.shop_supplier_delivery_receipts(unit_id,intent_id,supplier_account_id,original_request_id,
        supplier_order_no,contract_hash,proof_hash,evidence_hash,result_hash,actual_cost_cny,content_fingerprint,sealed,
        disposition,quarantine_reason,created_at)
    VALUES (v_unit.id,v_intent.id,v_intent.supplier_account_id,v_intent.original_request_id,v_intent.supplier_order_no,
        p_receipt->>'contractHash',p_receipt->>'proofHash',p_receipt->>'evidenceHash',v_result_hash,v_cost,
        p_receipt->'sealed'->>'fingerprint',p_receipt->'sealed',
        CASE WHEN v_reason IS NULL THEN 'delivered' ELSE 'quarantined' END,v_reason,v_now);
    -- An exceptional actual debit is still a fact. Preserve it with the encrypted
    -- content and keep exposure held for review; do not hide an overrun as NULL.
    UPDATE public.shop_supplier_procurement_intents SET actual_cost_cny = v_cost,
        exposure_status = CASE WHEN v_reason IS NULL THEN 'not_reserved' ELSE exposure_status END,
        reserved_cost_cny = CASE WHEN v_reason IS NULL THEN 0 ELSE reserved_cost_cny END WHERE id = v_intent.id;
    UPDATE public.shop_supplier_transaction_outbox SET
        status = CASE WHEN v_reason IS NULL THEN 'completed' ELSE 'review' END,
        block_reason = CASE WHEN v_reason IS NULL THEN 'supplier_delivered' ELSE 'delivery_quarantined' END
        WHERE intent_id = v_intent.id;
    IF v_reason IS NULL AND v_unit.funding_kind = 'points' THEN
        UPDATE public.shop_orders SET delivery_status = 'delivered', delivery_completed_at = v_now,
            delivery_updated_at = v_now, delivery_last_error = NULL, supplier_dispatch_version = supplier_dispatch_version + 1
            WHERE id = v_unit.shop_order_id;
    ELSIF v_reason IS NULL THEN
        UPDATE public.guest_shop_orders SET fulfillment_status = 'delivered', fulfilled_at = v_now,
            updated_at = v_now, supplier_dispatch_version = supplier_dispatch_version + 1 WHERE id = v_unit.guest_order_id;
    ELSE
        -- Also touch native to fence concurrent stale RR transactions.
        IF v_unit.funding_kind = 'points' THEN
            UPDATE public.shop_orders SET supplier_dispatch_version = supplier_dispatch_version + 1 WHERE id = v_unit.shop_order_id;
        ELSE
            UPDATE public.guest_shop_orders SET supplier_dispatch_version = supplier_dispatch_version + 1 WHERE id = v_unit.guest_order_id;
        END IF;
    END IF;
    RETURN jsonb_build_object('status',CASE WHEN v_reason IS NULL THEN 'delivered' ELSE 'quarantined' END,'applied',true);
END;
$$;

-- Authorization is an immutable private receipt, never a caller-set GUC or an
-- editable native status flag. The native ownership fields still cannot change.
CREATE OR REPLACE FUNCTION public.shop_supplier_delivery_projection_matches_v2(p_table TEXT, p_native JSONB)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM public.shop_supplier_delivery_receipts r
        JOIN public.shop_supplier_fulfillment_units u ON u.id = r.unit_id
        WHERE r.disposition = 'delivered' AND u.funding_state = 'funded' AND u.site = p_native->>'site'
        AND p_native->>'fulfillment_source' = 'supplier_v2'
        AND ((p_table = 'shop_orders' AND u.shop_order_id::TEXT = p_native->>'id'
            AND p_native->>'delivery_status' = 'delivered' AND COALESCE(p_native->>'refund_status','none') = 'none'
            AND (p_native->>'delivery_completed_at')::TIMESTAMPTZ = r.created_at
            AND (p_native->>'delivery_updated_at')::TIMESTAMPTZ = r.created_at
            AND p_native->>'inventory_id' IS NULL AND p_native->>'delivery_task_id' IS NULL)
        OR (p_table = 'guest_shop_orders' AND u.guest_order_id::TEXT = p_native->>'id'
            AND p_native->>'payment_status' = 'confirmed' AND p_native->>'refund_status' = 'none'
            AND p_native->>'reservation_status' = 'none' AND p_native->>'fulfillment_status' = 'delivered'
            AND (p_native->>'fulfilled_at')::TIMESTAMPTZ = r.created_at)));
$$;

CREATE OR REPLACE FUNCTION public.shop_supplier_native_order_guard_v2() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_quote public.shop_supplier_checkout_quotes%ROWTYPE;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.fulfillment_source IS DISTINCT FROM OLD.fulfillment_source THEN RAISE EXCEPTION 'supplier_source_immutable'; END IF;
        IF OLD.fulfillment_source <> 'supplier_v2' THEN RETURN NEW; END IF;
        IF NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.sku_id IS DISTINCT FROM OLD.sku_id
            OR NEW.site IS DISTINCT FROM OLD.site THEN RAISE EXCEPTION 'supplier_source_immutable'; END IF;
    ELSE
        IF TG_TABLE_NAME = 'shop_orders' THEN
            v_quote := public.shop_supplier_checkout_context_v2(NEW.product_id, NEW.sku_id, 'points', NEW.user_id);
        ELSE
            v_quote := public.shop_supplier_checkout_context_v2(NEW.product_id, NEW.sku_id, 'guest_cash', NULL);
        END IF;
        IF v_quote.id IS NULL THEN
            IF NEW.fulfillment_source <> 'local' THEN RAISE EXCEPTION 'supplier_checkout_unavailable'; END IF;
            RETURN NEW;
        END IF;
        NEW.fulfillment_source := 'supplier_v2';
        IF NEW.site IS DISTINCT FROM 'cn' THEN RAISE EXCEPTION 'supplier_checkout_scope_unsupported'; END IF;
        IF TG_TABLE_NAME = 'shop_orders' THEN
            IF NEW.item_count IS DISTINCT FROM 1 OR NEW.price_paid IS DISTINCT FROM v_quote.sale_amount THEN
                RAISE EXCEPTION 'supplier_quote_changed';
            END IF;
        ELSE
            IF NEW.quantity IS DISTINCT FROM 1 OR NEW.total_amount IS DISTINCT FROM v_quote.sale_amount THEN
                RAISE EXCEPTION 'supplier_quote_changed';
            END IF;
        END IF;
    END IF;
    -- Local inventory/task ownership stays forbidden. Only an immutable private
    -- receipt may authorize the exact native delivery projection.
    IF TG_TABLE_NAME = 'shop_orders' THEN
        IF NEW.inventory_id IS NOT NULL OR NEW.delivery_task_id IS NOT NULL THEN
            RAISE EXCEPTION 'supplier_local_fulfillment_forbidden';
        END IF;
        IF (NEW.delivery_status = 'delivered' OR NEW.delivery_completed_at IS NOT NULL)
            AND NOT public.shop_supplier_delivery_projection_matches_v2(TG_TABLE_NAME,to_jsonb(NEW)) THEN
            RAISE EXCEPTION 'supplier_verified_delivery_required';
        END IF;
    ELSE
        IF NEW.reservation_status IS DISTINCT FROM 'none' OR NEW.fulfillment_status = 'fulfilling' THEN
            RAISE EXCEPTION 'supplier_local_fulfillment_forbidden';
        END IF;
        IF (NEW.fulfillment_status = 'delivered' OR NEW.fulfilled_at IS NOT NULL)
            AND NOT public.shop_supplier_delivery_projection_matches_v2(TG_TABLE_NAME,to_jsonb(NEW)) THEN
            RAISE EXCEPTION 'supplier_verified_delivery_required';
        END IF;
        IF NEW.total_amount - COALESCE(NEW.payment_fee_amount, 0) IS DISTINCT FROM NEW.unit_amount * NEW.quantity THEN
            RAISE EXCEPTION 'supplier_quote_changed';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

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
        IF public.shop_supplier_delivery_projection_matches_v2(TG_TABLE_NAME,to_jsonb(NEW)) THEN
            IF TG_TABLE_NAME = 'shop_orders' AND
                to_jsonb(NEW) - ARRAY['delivery_status','delivery_completed_at','delivery_updated_at','delivery_last_error','supplier_dispatch_version']
                = to_jsonb(OLD) - ARRAY['delivery_status','delivery_completed_at','delivery_updated_at','delivery_last_error','supplier_dispatch_version'] THEN
                RETURN NEW;
            ELSIF TG_TABLE_NAME = 'guest_shop_orders' AND
                to_jsonb(NEW) - ARRAY['fulfillment_status','fulfilled_at','updated_at','supplier_dispatch_version']
                = to_jsonb(OLD) - ARRAY['fulfillment_status','fulfilled_at','updated_at','supplier_dispatch_version'] THEN
                RETURN NEW;
            END IF;
        END IF;
        RAISE EXCEPTION 'supplier_dispatch_resolution_required';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.shop_supplier_delivery_access_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id UUID NOT NULL REFERENCES public.shop_supplier_delivery_receipts(unit_id) ON DELETE RESTRICT,
    access_kind TEXT NOT NULL CHECK (access_kind IN ('customer_points','customer_guest')),
    buyer_user_id UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CHECK ((access_kind = 'customer_points' AND buyer_user_id IS NOT NULL)
        OR (access_kind = 'customer_guest' AND buyer_user_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_supplier_delivery_access_unit ON public.shop_supplier_delivery_access_events(unit_id,created_at);
ALTER TABLE public.shop_supplier_delivery_access_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_supplier_delivery_access_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.shop_supplier_delivery_access_events TO service_role;

-- This is a private server RPC. Points ownership is checked here AND in the
-- existing authenticated route. Guest claim/password/access-cookie authorization
-- must complete in the existing guest route before this RPC is called.
CREATE OR REPLACE FUNCTION public.fn_shop_supplier_customer_delivery_v2(
    p_order_id UUID, p_funding_kind TEXT, p_buyer_user_id UUID DEFAULT NULL, p_site TEXT DEFAULT 'cn'
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_unit public.shop_supplier_fulfillment_units%ROWTYPE;
    v_receipt public.shop_supplier_delivery_receipts%ROWTYPE;
    v_order public.shop_orders%ROWTYPE;
    v_guest public.guest_shop_orders%ROWTYPE;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'supplier_service_role_required'; END IF;
    IF p_order_id IS NULL OR p_funding_kind IS NULL OR p_funding_kind NOT IN ('points','guest_cash')
        OR p_site IS DISTINCT FROM 'cn' THEN RAISE EXCEPTION 'supplier_delivery_forbidden'; END IF;
    IF p_funding_kind = 'points' THEN
        SELECT * INTO v_order FROM public.shop_orders WHERE id = p_order_id AND user_id = p_buyer_user_id
            AND site = p_site AND fulfillment_source = 'supplier_v2' FOR SHARE;
        IF NOT FOUND THEN RAISE EXCEPTION 'supplier_delivery_forbidden'; END IF;
    ELSE
        IF p_buyer_user_id IS NOT NULL THEN RAISE EXCEPTION 'supplier_delivery_forbidden'; END IF;
        SELECT * INTO v_guest FROM public.guest_shop_orders WHERE id = p_order_id AND site = p_site
            AND fulfillment_source = 'supplier_v2' FOR SHARE;
        IF NOT FOUND THEN RAISE EXCEPTION 'supplier_delivery_forbidden'; END IF;
    END IF;
    SELECT * INTO v_unit FROM public.shop_supplier_fulfillment_units WHERE funding_kind = p_funding_kind AND site = p_site
        AND ((p_funding_kind = 'points' AND shop_order_id = p_order_id AND buyer_user_id = p_buyer_user_id)
            OR (p_funding_kind = 'guest_cash' AND guest_order_id = p_order_id)) FOR SHARE;
    IF NOT FOUND OR v_unit.funding_state <> 'funded' THEN RAISE EXCEPTION 'supplier_delivery_forbidden'; END IF;
    SELECT * INTO v_receipt FROM public.shop_supplier_delivery_receipts WHERE unit_id = v_unit.id;
    IF NOT FOUND OR v_receipt.disposition <> 'delivered' THEN RETURN jsonb_build_object('status','pending'); END IF;
    IF p_funding_kind = 'points' THEN
        IF NOT public.shop_supplier_delivery_projection_matches_v2('shop_orders',to_jsonb(v_order)) THEN
            RAISE EXCEPTION 'supplier_delivery_forbidden'; END IF;
    ELSE
        IF NOT public.shop_supplier_delivery_projection_matches_v2('guest_shop_orders',to_jsonb(v_guest)) THEN
            RAISE EXCEPTION 'supplier_delivery_forbidden'; END IF;
    END IF;
    INSERT INTO public.shop_supplier_delivery_access_events(unit_id,access_kind,buyer_user_id)
        VALUES (v_unit.id,CASE WHEN p_funding_kind = 'points' THEN 'customer_points' ELSE 'customer_guest' END,p_buyer_user_id);
    RETURN jsonb_build_object('status','delivered','unitId',v_unit.id,'intentId',v_receipt.intent_id,
        'orderNo',v_receipt.supplier_order_no,'sealed',v_receipt.sealed);
END;
$$;

-- Nonsecret operations projection. It never resolves credentials or queries a
-- merchant; disabled/retired accounts remain inspectable for old orders.
CREATE OR REPLACE FUNCTION public.fn_shop_supplier_operations_v2(
    p_provider_id TEXT DEFAULT NULL, p_account_key TEXT DEFAULT NULL, p_limit INTEGER DEFAULT 50,
    p_native_order_id UUID DEFAULT NULL, p_funding_kind TEXT DEFAULT NULL, p_site TEXT DEFAULT 'cn'
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_result JSONB;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'supplier_service_role_required'; END IF;
    IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_site IS DISTINCT FROM 'cn'
        OR (p_provider_id IS NOT NULL AND p_provider_id !~ '^[a-z0-9][a-z0-9._-]{0,79}$')
        OR (p_account_key IS NOT NULL AND p_account_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$')
        OR (p_funding_kind IS NOT NULL AND p_funding_kind NOT IN ('points','guest_cash'))
        OR (p_native_order_id IS NOT NULL AND p_funding_kind IS NULL) THEN
        RAISE EXCEPTION 'supplier_operations_invalid_request';
    END IF;
    WITH bounded AS (
        SELECT u.id, u.created_at,
            jsonb_build_object(
                'intentId',i.id,'nativeOrderId',COALESCE(u.shop_order_id,u.guest_order_id),
                'orderNo',COALESCE(g.order_no,u.shop_order_id::TEXT),'fundingKind',u.funding_kind,'site',u.site,
                'productName',COALESCE(o.snapshot_product_name,g.snapshot_product_name,''),
                'procurementState',i.status,'originalRequestId',i.original_request_id,'supplierOrderNo',i.supplier_order_no,
                'deliveryState',CASE WHEN r.unit_id IS NOT NULL THEN r.disposition
                    WHEN i.status = 'accepted' THEN 'awaiting_delivery' ELSE 'awaiting_acceptance' END,
                'actualCostCny',r.actual_cost_cny::TEXT,
                'costVerified',r.unit_id IS NOT NULL AND r.actual_cost_cny IS NOT DISTINCT FROM i.actual_cost_cny,
                'exposureStatus',i.exposure_status,'reservedCostCny',i.reserved_cost_cny::TEXT,
                'quarantineReason',r.quarantine_reason,'canRefund',false,
                'createdAt',u.created_at,'deliveredAt',CASE WHEN r.disposition = 'delivered' THEN r.created_at END
            ) AS payload
        FROM public.shop_supplier_fulfillment_units u
        JOIN public.shop_supplier_procurement_intents i ON i.unit_id = u.id
        JOIN public.shop_supplier_accounts a ON a.id = u.supplier_account_id
        LEFT JOIN public.shop_supplier_delivery_receipts r ON r.unit_id = u.id AND r.intent_id = i.id
        LEFT JOIN public.shop_orders o ON o.id = u.shop_order_id
        LEFT JOIN public.guest_shop_orders g ON g.id = u.guest_order_id
        WHERE u.site = p_site AND (p_provider_id IS NULL OR a.provider_id = p_provider_id)
            AND (p_account_key IS NULL OR a.account_key = p_account_key)
            AND (p_funding_kind IS NULL OR u.funding_kind = p_funding_kind)
            AND (p_native_order_id IS NULL OR COALESCE(u.shop_order_id,u.guest_order_id) = p_native_order_id)
        ORDER BY u.created_at DESC,u.id DESC LIMIT p_limit + 1
    ), visible AS (SELECT * FROM bounded ORDER BY created_at DESC,id DESC LIMIT p_limit)
    SELECT jsonb_build_object('rows',COALESCE((SELECT jsonb_agg(payload ORDER BY created_at DESC,id DESC) FROM visible),'[]'::JSONB),
        'hasMore',(SELECT count(*) > p_limit FROM bounded),'limit',p_limit) INTO v_result;
    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.shop_supplier_delivery_receipt_immutable_v2(),
    public.shop_supplier_delivery_projection_matches_v2(TEXT,JSONB),
    public.shop_supplier_native_order_guard_v2(),public.shop_supplier_dispatch_native_guard_v2()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_shop_supplier_delivery_ticket_v2(UUID,TEXT),
    public.fn_shop_supplier_record_delivery_v2(UUID,JSONB),
    public.fn_shop_supplier_customer_delivery_v2(UUID,TEXT,UUID,TEXT),
    public.fn_shop_supplier_operations_v2(TEXT,TEXT,INTEGER,UUID,TEXT,TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_shop_supplier_delivery_ticket_v2(UUID,TEXT),
    public.fn_shop_supplier_record_delivery_v2(UUID,JSONB),
    public.fn_shop_supplier_customer_delivery_v2(UUID,TEXT,UUID,TEXT),
    public.fn_shop_supplier_operations_v2(TEXT,TEXT,INTEGER,UUID,TEXT,TEXT) TO service_role;
COMMENT ON TABLE public.shop_supplier_delivery_receipts IS
    'Immutable encrypted supplier receipts. Actual debit facts; not marketing rewards, automatic refunds or merchant qualification.';
NOTIFY pgrst, 'reload schema';
COMMIT;
