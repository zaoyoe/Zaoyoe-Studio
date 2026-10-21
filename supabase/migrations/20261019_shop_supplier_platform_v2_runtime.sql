-- P2E: persistent, private runtime coordination. Apply AFTER P2D-2.
-- No merchant proof, enabled switches, scheduled job or real order is installed.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$ BEGIN
    IF to_regprocedure('public.fn_shop_supplier_resolve_customer_v2(text,uuid,uuid,uuid,text,jsonb)') IS NULL
        OR to_regprocedure('public.fn_shop_supplier_delivery_ticket_v2(uuid,text)') IS NULL THEN
        RAISE EXCEPTION 'Supplier P2D-2 customer resolution is required before P2E';
    END IF;
END; $$;

CREATE TABLE IF NOT EXISTS public.shop_supplier_runtime_accounts (
    supplier_account_id UUID PRIMARY KEY REFERENCES public.shop_supplier_accounts(id) ON DELETE RESTRICT,
    lease_intent_id UUID REFERENCES public.shop_supplier_procurement_intents(id) ON DELETE RESTRICT,
    lease_token UUID, lease_expires_at TIMESTAMPTZ,
    next_request_at TIMESTAMPTZ NOT NULL DEFAULT '-infinity',
    circuit_until TIMESTAMPTZ NOT NULL DEFAULT '-infinity',
    consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures BETWEEN 0 AND 20),
    CHECK ((lease_token IS NULL AND lease_intent_id IS NULL AND lease_expires_at IS NULL)
        OR (lease_token IS NOT NULL AND lease_intent_id IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS public.shop_supplier_runtime_jobs (
    intent_id UUID PRIMARY KEY REFERENCES public.shop_supplier_procurement_intents(id) ON DELETE RESTRICT,
    supplier_account_id UUID NOT NULL REFERENCES public.shop_supplier_runtime_accounts(supplier_account_id) ON DELETE RESTRICT,
    phase TEXT NOT NULL CHECK (phase IN ('dispatch','query','delivery','review','completed')),
    state TEXT NOT NULL DEFAULT 'waiting' CHECK (state IN ('waiting','running','review','completed')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 48),
    next_run_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    last_attempt_at TIMESTAMPTZ,
    lease_token UUID, lease_expires_at TIMESTAMPTZ, request_started_at TIMESTAMPTZ,
    last_code TEXT NOT NULL DEFAULT 'idle' CHECK (last_code IN ('idle','running','ok','pending','unknown',
        'blocked','disabled','contract_unverified','timeout','rate_limited','unavailable','quarantined')),
    alert_code TEXT CHECK (alert_code IN ('outcome_unknown','procurement_review','delivery_quarantined',
        'customer_closed_upstream_pending','adapter_unverified','runtime_exhausted','upstream_timeout',
        'upstream_rate_limited','upstream_unavailable','account_circuit_open','runtime_lease_expired','dispatch_blocked')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CHECK ((lease_token IS NULL AND lease_expires_at IS NULL AND state <> 'running')
        OR (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL AND state = 'running'))
);
CREATE INDEX IF NOT EXISTS idx_supplier_runtime_jobs_due_v2 ON public.shop_supplier_runtime_jobs(next_run_at)
    WHERE state IN ('waiting','running');
CREATE TABLE IF NOT EXISTS public.shop_supplier_runtime_resumes (
    operation_id UUID PRIMARY KEY, intent_id UUID NOT NULL REFERENCES public.shop_supplier_runtime_jobs(intent_id) ON DELETE RESTRICT,
    actor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    previous_phase TEXT NOT NULL, previous_attempts INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.shop_supplier_runtime_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_supplier_runtime_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_supplier_runtime_resumes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_supplier_runtime_accounts, public.shop_supplier_runtime_jobs,
    public.shop_supplier_runtime_resumes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.shop_supplier_runtime_accounts, public.shop_supplier_runtime_jobs,
    public.shop_supplier_runtime_resumes TO service_role;
CREATE OR REPLACE FUNCTION public.shop_supplier_runtime_resume_immutable_v2() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN RAISE EXCEPTION 'supplier_runtime_resume_immutable'; END; $$;
DROP TRIGGER IF EXISTS tr_supplier_runtime_resume_immutable_v2 ON public.shop_supplier_runtime_resumes;
CREATE TRIGGER tr_supplier_runtime_resume_immutable_v2 BEFORE UPDATE OR DELETE ON public.shop_supplier_runtime_resumes
    FOR EACH ROW EXECUTE FUNCTION public.shop_supplier_runtime_resume_immutable_v2();

-- Read authoritative business state, including late-goods recovery after customer closure.
-- No locks or writes to any native order, funding, intent, proof or receipt here.
CREATE OR REPLACE FUNCTION public.shop_supplier_runtime_plan_v2(p_intent_id UUID DEFAULT NULL)
RETURNS TABLE(intent_id UUID,supplier_account_id UUID,phase TEXT,ready_at TIMESTAMPTZ,
    deadline_at TIMESTAMPTZ,alert_code TEXT) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT i.id,i.supplier_account_id,
        CASE WHEN r.disposition = 'delivered' THEN 'completed'
            WHEN r.disposition = 'quarantined' OR i.status IN ('rejected','review') OR u.funding_state <> 'funded' THEN 'review'
            WHEN i.status = 'accepted' THEN 'delivery'
            WHEN i.status IN ('dispatching','outcome_unknown') THEN 'query'
            WHEN c.unit_id IS NOT NULL OR i.exposure_status <> 'held' THEN 'review'
            ELSE 'dispatch' END,
        CASE WHEN i.status IN ('dispatching','outcome_unknown') THEN
            greatest(coalesce(d.next_query_at,i.created_at),coalesce(d.lease_expires_at,i.created_at))
            WHEN i.status = 'prepared' THEN coalesce(d.lease_expires_at,i.created_at) ELSE i.created_at END,
        CASE WHEN i.status = 'accepted' THEN coalesce(d.updated_at,i.created_at) + INTERVAL '24 hours'
            ELSE coalesce(d.reconcile_deadline_at,i.created_at + INTERVAL '24 hours') END,
        CASE WHEN r.disposition = 'delivered' THEN NULL
            WHEN r.disposition = 'quarantined' THEN 'delivery_quarantined'
            WHEN i.status IN ('rejected','review') THEN 'procurement_review'
            WHEN c.unit_id IS NOT NULL AND i.status IN ('accepted','dispatching','outcome_unknown') THEN 'customer_closed_upstream_pending'
            WHEN i.status IN ('dispatching','outcome_unknown') THEN 'outcome_unknown'
            WHEN c.unit_id IS NOT NULL THEN 'procurement_review' END
    FROM public.shop_supplier_procurement_intents i
    JOIN public.shop_supplier_fulfillment_units u ON u.id = i.unit_id
    LEFT JOIN public.shop_supplier_dispatch_attempts d ON d.intent_id = i.id
    LEFT JOIN public.shop_supplier_delivery_receipts r ON r.intent_id = i.id
    LEFT JOIN public.shop_supplier_customer_resolutions c ON c.unit_id = u.id
    WHERE u.site = 'cn' AND (p_intent_id IS NULL OR i.id = p_intent_id);
$$;

CREATE OR REPLACE FUNCTION public.fn_shop_supplier_runtime_v2(
    p_action TEXT, p_intent_id UUID DEFAULT NULL, p_token UUID DEFAULT NULL,
    p_phase TEXT DEFAULT NULL, p_outcome TEXT DEFAULT NULL,
    p_phases TEXT[] DEFAULT NULL, p_limit INTEGER DEFAULT 5, p_actor_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_plan RECORD;
    v_job public.shop_supplier_runtime_jobs%ROWTYPE;
    v_account public.shop_supplier_runtime_accounts%ROWTYPE;
    v_resume public.shop_supplier_runtime_resumes%ROWTYPE;
    v_now TIMESTAMPTZ;
    v_token UUID;
    v_result JSONB;
    v_failure BOOLEAN;
    v_alert TEXT;
    v_delay INTEGER;
    v_review BOOLEAN;
BEGIN
    IF COALESCE(auth.role(),'') <> 'service_role' THEN RAISE EXCEPTION 'supplier_service_role_required'; END IF;
    IF p_action IS NULL OR p_action NOT IN ('scan','claim','start','finish','resume')
        OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'supplier_runtime_invalid_request'; END IF;
    IF p_action IN ('scan','claim') AND (p_phases IS NULL OR cardinality(p_phases) NOT BETWEEN 1 AND 3
        OR array_position(p_phases,NULL) IS NOT NULL OR NOT p_phases <@ ARRAY['dispatch','query','delivery']::TEXT[]) THEN
        RAISE EXCEPTION 'supplier_runtime_invalid_phases';
    END IF;
    v_now := clock_timestamp();
    IF p_action = 'scan' THEN
        WITH eligible AS (
            SELECT p.intent_id,p.phase,p.supplier_account_id,coalesce(j.next_run_at,p.ready_at) AS due_at
            FROM public.shop_supplier_runtime_plan_v2() p
            LEFT JOIN public.shop_supplier_runtime_jobs j ON j.intent_id = p.intent_id
            LEFT JOIN public.shop_supplier_runtime_accounts a ON a.supplier_account_id = p.supplier_account_id
            WHERE p.phase = ANY(p_phases) AND p.ready_at <= v_now
                AND (j.intent_id IS NULL OR j.phase <> p.phase OR (j.state <> 'review' AND j.next_run_at <= v_now))
                AND (j.lease_expires_at IS NULL OR j.lease_expires_at <= v_now)
                AND (a.lease_expires_at IS NULL OR a.lease_expires_at <= v_now)
                AND coalesce(a.next_request_at,'-infinity') <= v_now AND coalesce(a.circuit_until,'-infinity') <= v_now
        ), per_account AS (
            SELECT DISTINCT ON (supplier_account_id) intent_id,phase,due_at FROM eligible
            ORDER BY supplier_account_id,CASE phase WHEN 'query' THEN 0 WHEN 'delivery' THEN 1 ELSE 2 END,due_at,intent_id
        ), candidates AS (
            SELECT intent_id,phase FROM per_account
            ORDER BY CASE phase WHEN 'query' THEN 0 WHEN 'delivery' THEN 1 ELSE 2 END,due_at,intent_id LIMIT p_limit
        ) SELECT jsonb_build_object('jobs',coalesce(jsonb_agg(jsonb_build_object('intentId',intent_id,'phase',phase)),'[]'::JSONB))
            INTO v_result FROM candidates;
        RETURN v_result;
    END IF;
    IF p_intent_id IS NULL THEN RAISE EXCEPTION 'supplier_runtime_invalid_request'; END IF;
    SELECT * INTO v_plan FROM public.shop_supplier_runtime_plan_v2(p_intent_id);
    IF NOT FOUND THEN RAISE EXCEPTION 'supplier_runtime_intent_missing'; END IF;
    -- Coordinator-only locks: runtime account -> runtime job. These transactions
    -- NEVER lock or write native/funding/policy/intent/attempt rows. Business RPCs
    -- retain their native -> funding -> policy -> intent -> attempt lock order.
    INSERT INTO public.shop_supplier_runtime_accounts(supplier_account_id) VALUES (v_plan.supplier_account_id) ON CONFLICT DO NOTHING;
    SELECT * INTO STRICT v_account FROM public.shop_supplier_runtime_accounts WHERE supplier_account_id = v_plan.supplier_account_id FOR UPDATE;
    INSERT INTO public.shop_supplier_runtime_jobs(intent_id,supplier_account_id,phase,alert_code)
        VALUES (p_intent_id,v_plan.supplier_account_id,v_plan.phase,v_plan.alert_code) ON CONFLICT DO NOTHING;
    SELECT * INTO STRICT v_job FROM public.shop_supplier_runtime_jobs WHERE intent_id = p_intent_id FOR UPDATE;
    SELECT * INTO STRICT v_plan FROM public.shop_supplier_runtime_plan_v2(p_intent_id);
    v_now := clock_timestamp();
    IF v_job.supplier_account_id IS DISTINCT FROM v_plan.supplier_account_id THEN RAISE EXCEPTION 'supplier_runtime_identity_conflict'; END IF;
    IF p_action = 'claim' THEN
        IF (v_job.lease_expires_at > v_now) OR (v_account.lease_expires_at > v_now)
            OR v_account.next_request_at > v_now OR v_account.circuit_until > v_now
            OR p_phase IS NULL OR p_phase IS DISTINCT FROM v_plan.phase
            OR NOT v_plan.phase = ANY(p_phases) OR v_plan.ready_at > v_now THEN
            RETURN jsonb_build_object('acquired',false);
        END IF;
        IF v_job.phase IS DISTINCT FROM v_plan.phase THEN
            UPDATE public.shop_supplier_runtime_jobs SET phase = v_plan.phase,attempts = 0,state = 'waiting',next_run_at = v_now,
                lease_token = NULL,lease_expires_at = NULL,request_started_at = NULL,last_code = 'idle',alert_code = v_plan.alert_code,updated_at = v_now
                WHERE intent_id = p_intent_id RETURNING * INTO v_job;
        END IF;
        IF v_job.state = 'review' OR v_job.next_run_at > v_now THEN RETURN jsonb_build_object('acquired',false); END IF;
        IF v_job.attempts >= 24 OR v_plan.deadline_at <= v_now THEN
            UPDATE public.shop_supplier_runtime_jobs SET state = 'review',lease_token = NULL,lease_expires_at = NULL,
                alert_code = 'runtime_exhausted',updated_at = v_now WHERE intent_id = p_intent_id;
            RETURN jsonb_build_object('acquired',false);
        END IF;
        v_token := gen_random_uuid();
        UPDATE public.shop_supplier_runtime_accounts SET lease_intent_id = p_intent_id,lease_token = v_token,
            lease_expires_at = v_now + INTERVAL '90 seconds',next_request_at = v_now + INTERVAL '20 seconds'
            WHERE supplier_account_id = v_plan.supplier_account_id;
        UPDATE public.shop_supplier_runtime_jobs SET phase = v_plan.phase,state = 'running',attempts = attempts + 1,
            lease_token = v_token,lease_expires_at = v_now + INTERVAL '90 seconds',request_started_at = NULL,
            last_attempt_at = v_now,last_code = 'running',
            alert_code = CASE WHEN v_job.lease_token IS NOT NULL THEN 'runtime_lease_expired' ELSE v_plan.alert_code END,
            updated_at = v_now WHERE intent_id = p_intent_id;
        RETURN jsonb_build_object('acquired',true,'intentId',p_intent_id,'accountId',v_plan.supplier_account_id,'phase',v_plan.phase,'token',v_token);
    END IF;
    IF p_action = 'resume' THEN
        IF p_actor_id IS NULL OR p_token IS NULL THEN RAISE EXCEPTION 'supplier_runtime_actor_required'; END IF;
        SELECT * INTO v_resume FROM public.shop_supplier_runtime_resumes WHERE operation_id = p_token;
        IF FOUND THEN
            IF v_resume.intent_id IS DISTINCT FROM p_intent_id OR v_resume.actor_id IS DISTINCT FROM p_actor_id THEN
                RAISE EXCEPTION 'supplier_runtime_identity_conflict';
            END IF;
            RETURN jsonb_build_object('applied',true,'operationId',p_token);
        END IF;
        IF v_job.lease_expires_at > v_now OR v_plan.phase NOT IN ('dispatch','query','delivery')
            OR v_job.state <> 'review' OR v_plan.deadline_at <= v_now THEN RETURN jsonb_build_object('applied',false,'operationId',p_token); END IF;
        INSERT INTO public.shop_supplier_runtime_resumes(operation_id,intent_id,actor_id,previous_phase,previous_attempts)
            VALUES(p_token,p_intent_id,p_actor_id,v_job.phase,v_job.attempts);
        UPDATE public.shop_supplier_runtime_jobs SET phase = v_plan.phase,state = 'waiting',attempts = 0,next_run_at = v_now,
            lease_token = NULL,lease_expires_at = NULL,request_started_at = NULL,last_code = 'idle',
            alert_code = v_plan.alert_code,updated_at = v_now WHERE intent_id = p_intent_id;
        -- Do not change the original procurement deadline, account circuit,
        -- merchant proof, dispatch policy, financial state or request identity.
        RETURN jsonb_build_object('applied',true,'operationId',p_token);
    END IF;
    -- Shared lease validation does not require an upstream ACK marker; start
    -- must be allowed to create the first marker for this request.
    IF p_token IS NULL OR v_job.lease_token IS DISTINCT FROM p_token OR v_account.lease_token IS DISTINCT FROM p_token
        OR v_account.lease_intent_id IS DISTINCT FROM p_intent_id OR v_job.lease_expires_at <= v_now
        OR v_account.lease_expires_at <= v_now THEN RETURN jsonb_build_object('applied',false); END IF;
    IF p_action = 'start' THEN
        IF v_plan.deadline_at <= v_now OR p_phase IS NULL OR p_phase IS DISTINCT FROM v_job.phase
            OR v_job.state <> 'running'
            OR (p_phase = 'dispatch' AND EXISTS (SELECT 1 FROM public.shop_supplier_customer_resolutions c
                JOIN public.shop_supplier_procurement_intents i ON i.unit_id = c.unit_id WHERE i.id = p_intent_id))
            OR (p_phase IS DISTINCT FROM v_plan.phase AND NOT (p_phase = 'dispatch' AND v_plan.phase = 'query' AND EXISTS (
                SELECT 1 FROM public.shop_supplier_dispatch_attempts d WHERE d.intent_id = p_intent_id
                    AND d.state = 'dispatching' AND d.lease_kind = 'dispatch'
                    AND d.request_started_at >= v_job.last_attempt_at AND d.lease_expires_at > v_now)))
            OR v_job.lease_expires_at < v_now + INTERVAL '25 seconds' OR v_job.request_started_at IS NOT NULL THEN RETURN jsonb_build_object('applied',false); END IF;
        UPDATE public.shop_supplier_runtime_jobs SET request_started_at = v_now WHERE intent_id = p_intent_id;
        UPDATE public.shop_supplier_runtime_accounts SET next_request_at = v_now + INTERVAL '20 seconds'
            WHERE supplier_account_id = v_plan.supplier_account_id;
        RETURN jsonb_build_object('applied',true,'intentId',p_intent_id,'accountId',v_plan.supplier_account_id,'phase',p_phase,'token',p_token);
    END IF;
    IF p_action = 'finish' AND (v_job.state <> 'running' OR v_job.request_started_at IS NULL) THEN
        RETURN jsonb_build_object('applied',false);
    END IF;
    IF p_outcome IS NULL OR p_outcome NOT IN ('ok','pending','unknown','blocked','disabled','contract_unverified',
        'timeout','rate_limited','unavailable','quarantined') THEN RAISE EXCEPTION 'supplier_runtime_invalid_outcome'; END IF;
    v_failure := p_outcome IN ('timeout','rate_limited','unavailable');
    UPDATE public.shop_supplier_runtime_accounts SET lease_intent_id = CASE WHEN p_outcome = 'timeout' THEN lease_intent_id END,
        lease_token = CASE WHEN p_outcome = 'timeout' THEN lease_token END,
        lease_expires_at = CASE WHEN p_outcome = 'timeout' THEN lease_expires_at END,
        consecutive_failures = CASE WHEN v_failure THEN least(20,consecutive_failures + 1) ELSE 0 END,
        circuit_until = CASE WHEN v_failure AND consecutive_failures + 1 >= 3 THEN v_now + INTERVAL '5 minutes' ELSE circuit_until END
        WHERE supplier_account_id = v_plan.supplier_account_id;
    v_review := v_plan.phase = 'review' OR (v_job.phase = v_plan.phase AND
        (v_job.attempts >= 24 OR v_plan.deadline_at <= v_now OR (p_outcome = 'contract_unverified' AND v_job.attempts >= 3)));
    v_alert := CASE WHEN v_plan.phase = 'completed' THEN NULL
        WHEN v_plan.alert_code IN ('delivery_quarantined','customer_closed_upstream_pending','procurement_review') THEN v_plan.alert_code
        WHEN v_review AND p_outcome = 'contract_unverified' THEN 'adapter_unverified'
        WHEN v_review THEN 'runtime_exhausted'
        WHEN v_failure AND v_account.consecutive_failures + 1 >= 3 THEN 'account_circuit_open'
        WHEN p_outcome = 'timeout' THEN 'upstream_timeout' WHEN p_outcome = 'rate_limited' THEN 'upstream_rate_limited'
        WHEN p_outcome = 'unavailable' THEN 'upstream_unavailable'
        WHEN p_outcome = 'contract_unverified' THEN 'adapter_unverified'
        WHEN p_outcome = 'blocked' THEN 'dispatch_blocked' ELSE v_plan.alert_code END;
    v_delay := least(3600,30 * power(2,least(7,greatest(0,v_job.attempts - 1)))::INTEGER);
    UPDATE public.shop_supplier_runtime_jobs SET phase = v_plan.phase,
        state = CASE WHEN v_plan.phase = 'completed' THEN 'completed' WHEN v_review THEN 'review' ELSE 'waiting' END,
        attempts = CASE WHEN v_job.phase <> v_plan.phase THEN 0 ELSE attempts END,
        next_run_at = greatest(v_plan.ready_at,v_now + make_interval(secs => CASE WHEN v_job.phase <> v_plan.phase THEN 0 ELSE v_delay END)),
        last_code = p_outcome,alert_code = v_alert,lease_token = NULL,lease_expires_at = NULL,request_started_at = NULL,updated_at = v_now
        WHERE intent_id = p_intent_id;
    RETURN jsonb_build_object('applied',true,'intentId',p_intent_id,'token',p_token);
END;
$$;

CREATE OR REPLACE FUNCTION public.shop_supplier_runtime_projection_v2(p_intent_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT jsonb_build_object('phase',p.phase,
        'state',CASE WHEN p.phase = 'completed' THEN 'completed' WHEN p.phase = 'review' THEN 'review'
            WHEN j.intent_id IS NULL THEN 'untracked'
            WHEN j.phase <> p.phase THEN 'waiting'
            WHEN j.lease_expires_at <= now() THEN 'waiting' ELSE j.state END,
        'attempts',CASE WHEN j.phase = p.phase THEN coalesce(j.attempts,0) ELSE 0 END,
        'lastCode',coalesce(j.last_code,'idle'),
        'alertCode',CASE WHEN p.phase = 'completed' THEN NULL WHEN p.alert_code IN ('delivery_quarantined','customer_closed_upstream_pending','procurement_review') THEN p.alert_code
            ELSE coalesce(j.alert_code,p.alert_code) END,
        'nextRunAt',CASE WHEN p.phase IN ('review','completed') OR (j.phase = p.phase AND j.state = 'review') THEN NULL
            ELSE greatest(p.ready_at,CASE WHEN j.phase = p.phase THEN j.next_run_at END,a.next_request_at,a.circuit_until,
                a.lease_expires_at,j.lease_expires_at) END,
        'lastAttemptAt',j.last_attempt_at)
    FROM public.shop_supplier_runtime_plan_v2(p_intent_id) p
    LEFT JOIN public.shop_supplier_runtime_jobs j ON j.intent_id = p.intent_id
    LEFT JOIN public.shop_supplier_runtime_accounts a ON a.supplier_account_id = p.supplier_account_id;
$$;

-- Preserve the P2D-2 customer resolution/financial projection verbatim.
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
                'runtime',public.shop_supplier_runtime_projection_v2(i.id),
                'deliveryState',CASE WHEN r.unit_id IS NOT NULL THEN r.disposition
                    WHEN i.status = 'accepted' THEN 'awaiting_delivery' ELSE 'awaiting_acceptance' END,
                'actualCostCny',r.actual_cost_cny::TEXT,
                'costVerified',r.unit_id IS NOT NULL AND r.actual_cost_cny IS NOT DISTINCT FROM i.actual_cost_cny,
                'exposureStatus',i.exposure_status,'reservedCostCny',i.reserved_cost_cny::TEXT,
                'quarantineReason',r.quarantine_reason,'canRefund',false,
                'customerResolution',c.customer_result,'resolutionOperationId',c.operation_id,
                'resolutionAmount',(CASE WHEN u.funding_kind = 'points' THEN u.sale_amount ELSE g.total_amount END)::TEXT,
                'canResolve',COALESCE(c.unit_id IS NULL AND u.funding_state = 'funded'
                    AND COALESCE(r.disposition,'') <> 'delivered' AND (CASE WHEN u.funding_kind = 'points' THEN
                        o.fulfillment_source = 'supplier_v2' AND o.user_id = u.buyer_user_id AND o.price_paid = u.sale_amount
                        AND u.sale_amount > 0 AND COALESCE(o.refund_status,'none') = 'none' AND o.delivery_status IN ('pending','failed')
                        AND o.inventory_id IS NULL AND o.delivery_task_id IS NULL AND o.delivery_completed_at IS NULL
                        AND o.item_count = 1 AND COALESCE(o.discount_amount,0) = 0
                        AND o.paid_points_spent >= 0 AND o.bonus_points_spent >= 0
                        AND o.paid_points_spent + o.bonus_points_spent = u.sale_amount
                        AND NOT EXISTS (SELECT 1 FROM public.points_ledger l WHERE l.user_id = o.user_id
                            AND l.reference_id = 'REFUND_' || o.id::TEXT AND l.site = 'cn')
                    ELSE g.fulfillment_source = 'supplier_v2' AND g.payment_status = 'confirmed' AND g.refund_status = 'none'
                        AND g.fulfillment_status IN ('pending','failed','dead_letter','paid_unfulfillable')
                        AND g.fulfilled_at IS NULL AND g.paid_at IS NOT NULL AND g.currency = 'CNY'
                        AND g.quantity = 1 AND g.reservation_status = 'none' AND g.unit_amount = u.sale_amount
                        AND g.total_amount - COALESCE(g.payment_fee_amount,0) = u.sale_amount AND g.total_amount > 0
                    END),false),
                'createdAt',u.created_at,'deliveredAt',CASE WHEN r.disposition = 'delivered' THEN r.created_at END
            ) AS payload
        FROM public.shop_supplier_fulfillment_units u
        JOIN public.shop_supplier_procurement_intents i ON i.unit_id = u.id
        JOIN public.shop_supplier_accounts a ON a.id = u.supplier_account_id
        LEFT JOIN public.shop_supplier_delivery_receipts r ON r.unit_id = u.id AND r.intent_id = i.id
        LEFT JOIN public.shop_supplier_customer_resolutions c ON c.unit_id = u.id
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

REVOKE ALL ON FUNCTION public.shop_supplier_runtime_resume_immutable_v2(),
    public.shop_supplier_runtime_plan_v2(UUID),public.shop_supplier_runtime_projection_v2(UUID),
    public.fn_shop_supplier_runtime_v2(TEXT,UUID,UUID,TEXT,TEXT,TEXT[],INTEGER,UUID)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_shop_supplier_runtime_v2(TEXT,UUID,UUID,TEXT,TEXT,TEXT[],INTEGER,UUID) TO service_role;
COMMENT ON TABLE public.shop_supplier_runtime_jobs IS
    'P2E private coordination only; no financial writes or merchant evidence. Runtime and provider admission remain default off.';
COMMENT ON FUNCTION public.fn_shop_supplier_runtime_v2(TEXT,UUID,UUID,TEXT,TEXT,TEXT[],INTEGER,UUID) IS
    'Private scan/claim/start/finish/resume. Account lease, DB backoff, exact tokens. No worker schedule installed; concurrency/business acceptance NOT RUN.';
COMMIT;
