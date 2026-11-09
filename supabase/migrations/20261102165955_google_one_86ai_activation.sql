-- 86AI activation-only workflow. NOT APPLIED by this change.
-- No passwords, TOTP secrets, card codes or provider result text are persisted.
CREATE TABLE public.google_one_activation_jobs (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id),
    site varchar NOT NULL CHECK (site IN ('cn', 'intl')),
    email text NOT NULL,
    account_hash text NOT NULL CHECK (account_hash ~ '^[a-f0-9]{64}$'),
    card_fingerprint text NOT NULL CHECK (card_fingerprint ~ '^[a-f0-9]{64}$'),
    upstream_task_id bigint CHECK (upstream_task_id > 0 AND upstream_task_id <= 9007199254740991),
    status text NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared','submitting','queued','running','verification_pending','outcome_unknown','success','failed','cancelled')),
    billing_state text NOT NULL DEFAULT 'reserved' CHECK (billing_state IN ('reserved','charged','refunded')),
    price numeric(18,6) NOT NULL CHECK (price > 0 AND price <= 1000000 AND price = trunc(price,2)),
    deducted_paid numeric(18,6) NOT NULL,
    deducted_bonus numeric(18,6) NOT NULL,
    reference_id text NOT NULL UNIQUE,
    dispatch_token uuid,
    dispatched_at timestamptz,
    poll_token uuid,
    poll_lease_until timestamptz,
    next_poll_at timestamptz NOT NULL DEFAULT now(),
    review_reason text,
    reviewed_by uuid REFERENCES auth.users(id),
    reviewed_at timestamptz,
    evidence_ref text,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (deducted_paid >= 0 AND deducted_bonus >= 0 AND deducted_paid + deducted_bonus = price),
    CHECK ((status = 'success' AND billing_state = 'charged') OR
           (status IN ('failed','cancelled') AND billing_state = 'refunded') OR
           (status NOT IN ('success','failed','cancelled') AND billing_state = 'reserved')),
    UNIQUE (card_fingerprint, upstream_task_id)
);
-- Also prevent a second activation of an already confirmed account.
CREATE UNIQUE INDEX google_one_activation_account_guard ON public.google_one_activation_jobs(site, account_hash)
    WHERE status NOT IN ('failed','cancelled');
CREATE INDEX google_one_activation_owner ON public.google_one_activation_jobs(user_id, site, created_at DESC);
CREATE INDEX google_one_activation_review ON public.google_one_activation_jobs(site, status, created_at);
CREATE TABLE public.google_one_activation_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id uuid NOT NULL REFERENCES public.google_one_activation_jobs(id),
    actor_id uuid NOT NULL REFERENCES auth.users(id),
    action text NOT NULL,
    evidence_ref text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.google_one_activation_rate_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('submit','poll')),
    card_fingerprint text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX google_one_activation_rate_window ON public.google_one_activation_rate_events(kind, created_at);
ALTER TABLE public.google_one_activation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_one_activation_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_one_activation_rate_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.google_one_activation_jobs, public.google_one_activation_audit, public.google_one_activation_rate_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.google_one_activation_jobs, public.google_one_activation_audit, public.google_one_activation_rate_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.google_one_activation_audit_id_seq, public.google_one_activation_rate_events_id_seq TO service_role;

-- Independent journal: activation IDs are NOT shop order IDs. Hold source lots at
-- reservation time; success consumes the hold, failure restores the exact lots.
CREATE TABLE public.google_one_activation_lot_allocations (
    job_id uuid NOT NULL REFERENCES public.google_one_activation_jobs(id),
    point_lot_id uuid NOT NULL REFERENCES public.wallet_point_lots(id),
    component text NOT NULL CHECK (component IN ('paid','bonus')),
    points_amount numeric(14,2) NOT NULL CHECK (points_amount > 0),
    refunded_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (job_id, point_lot_id)
);
ALTER TABLE public.google_one_activation_lot_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.google_one_activation_lot_allocations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.google_one_activation_lot_allocations TO service_role;

CREATE FUNCTION public.fn_google_one_activation(p_action text, p_job_id uuid, p_user_id uuid, p_site varchar, p_data jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
    j public.google_one_activation_jobs%ROWTYPE;
    balance public.points_balance%ROWTYPE;
    lot record;
    allocation record;
    component text;
    bonus numeric(18,6);
    paid numeric(18,6);
    remaining numeric(18,6);
    take_points numeric(18,6);
    target_status text;
    retry_seconds integer;
    upstream_status integer;
    v_price numeric(18,6);
    evidence text;
    needs_refund boolean := false;
BEGIN
    IF p_site NOT IN ('cn','intl') OR p_site IS NULL OR p_user_id IS NULL THEN
        RETURN jsonb_build_object('ok',false,'code','activation_not_found');
    END IF;
    -- One transaction-scoped lock serializes claims/limits across all Vercel/KVM4 processes.
    -- The intentionally conservative global quota is <= the documented per-IP quota.
    PERFORM pg_advisory_xact_lock(hashtextextended('google-one-86ai-v1',0));
    IF p_action IN ('list','admin_list') THEN
        UPDATE public.google_one_activation_jobs SET status='outcome_unknown', review_reason='dispatch_timeout', version=version+1, updated_at=now()
            WHERE site=p_site AND (p_action='admin_list' OR user_id=p_user_id)
            AND status='submitting' AND dispatched_at < now()-interval '60 seconds';
        UPDATE public.google_one_activation_jobs SET status='outcome_unknown', review_reason='activation_timeout', version=version+1, updated_at=now()
            WHERE site=p_site AND (p_action='admin_list' OR user_id=p_user_id)
            AND status IN ('queued','running') AND created_at < now()-interval '24 hours';
        RETURN jsonb_build_object('ok',true,'jobs',COALESCE((
            SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM public.google_one_activation_jobs
                WHERE site=p_site AND (p_action='admin_list' OR user_id=p_user_id)
                ORDER BY CASE WHEN status IN ('verification_pending','outcome_unknown') THEN 0 WHEN status IN ('success','failed','cancelled') THEN 2 ELSE 1 END, created_at DESC LIMIT 100) x
        ),'[]'::jsonb));
    END IF;
    SELECT * INTO j FROM public.google_one_activation_jobs WHERE id=p_job_id AND site=p_site FOR UPDATE;
    IF FOUND AND (p_action NOT IN ('admin_read','admin_bind','admin_resolve')) AND j.user_id<>p_user_id THEN
        RETURN jsonb_build_object('ok',false,'code','activation_not_found');
    END IF;
    IF j.id IS NOT NULL AND j.status='submitting' AND j.dispatched_at < now()-interval '60 seconds' THEN
        UPDATE public.google_one_activation_jobs SET status='outcome_unknown',review_reason='dispatch_timeout',version=version+1,updated_at=now()
            WHERE id=j.id RETURNING * INTO j;
    END IF;
    IF j.id IS NOT NULL AND j.status IN ('queued','running') AND j.created_at < now()-interval '24 hours' THEN
        UPDATE public.google_one_activation_jobs SET status='outcome_unknown',review_reason='activation_timeout',version=version+1,updated_at=now()
            WHERE id=j.id RETURNING * INTO j;
    END IF;
    IF p_action='lookup' THEN RETURN jsonb_build_object('ok',true,'job',CASE WHEN j.id IS NULL THEN NULL ELSE to_jsonb(j) END); END IF;
    IF p_action='prepare' THEN
        IF j.id IS NOT NULL THEN
            IF j.email<>p_data->>'email' THEN RETURN jsonb_build_object('ok',false,'code','activation_request_conflict'); END IF;
            RETURN jsonb_build_object('ok',true,'job',to_jsonb(j));
        END IF;
        IF EXISTS (SELECT 1 FROM public.google_one_activation_jobs WHERE site=p_site AND account_hash=p_data->>'account_hash' AND status NOT IN ('failed','cancelled')) THEN
            RETURN jsonb_build_object('ok',false,'code','activation_duplicate_account');
        END IF;
        v_price := (p_data->>'price')::numeric;
        IF v_price IS NULL OR v_price<=0 OR v_price>1000000 OR v_price<>trunc(v_price,2) THEN
            RAISE EXCEPTION 'invalid_activation_price'; END IF;
        -- Whole cents only for this channel. Preserve existing six-decimal wallet
        -- dust; never round it up or widen the site's two-decimal source lots.
        SELECT * INTO balance FROM public.points_balance WHERE user_id=p_user_id AND site=p_site FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'activation_insufficient_points'; END IF;
        bonus := least(v_price, floor(greatest(0,balance.bonus_balance)*100)/100);
        paid := v_price-bonus;
        IF floor(greatest(0,balance.paid_balance)*100)/100 < paid THEN
            RAISE EXCEPTION 'activation_insufficient_points'; END IF;
        IF EXISTS (SELECT 1 FROM public.points_ledger WHERE user_id=p_user_id AND site=p_site AND reference_id='gpro_'||p_job_id::text) THEN
            RAISE EXCEPTION 'activation_request_conflict'; END IF;
        INSERT INTO public.google_one_activation_jobs(id,user_id,site,email,account_hash,card_fingerprint,price,deducted_paid,deducted_bonus,reference_id)
            VALUES(p_job_id,p_user_id,p_site,p_data->>'email',p_data->>'account_hash',p_data->>'card_fingerprint',v_price,
                paid,bonus,'gpro_'||p_job_id::text) RETURNING * INTO j;
        -- Lock balance -> lots in a stable order. The CASE is mutually exclusive:
        -- an explicitly bonus-marked recharge lot can NEVER fund the paid bucket.
        FOREACH component IN ARRAY ARRAY['bonus','paid'] LOOP
            remaining := CASE WHEN component='bonus' THEN bonus ELSE paid END;
            FOR lot IN SELECT l.* FROM public.wallet_point_lots l
                WHERE l.user_id=p_user_id AND l.site=p_site AND l.points_remaining>0
                AND (l.expires_at IS NULL OR l.expires_at>now())
                AND CASE
                    WHEN l.metadata->>'component' IN ('bonus','paid') THEN l.metadata->>'component'
                    WHEN coalesce(l.metadata->>'component','')<>'' THEN 'unclassified'
                    WHEN l.source_type IN ('checkin','activity_bonus','admin_grant','affiliate_commission','migration','unknown')
                        AND coalesce(l.cash_value_rate,0)<=0 THEN 'bonus'
                    WHEN l.source_type IN ('recharge','redemption_code') OR coalesce(l.cash_value_rate,0)>0 THEN 'paid'
                    ELSE 'unclassified' END = component
                ORDER BY l.acquired_at,l.created_at,l.id FOR UPDATE
            LOOP
                EXIT WHEN remaining<=0;
                take_points := least(remaining,lot.points_remaining);
                UPDATE public.wallet_point_lots SET points_remaining=points_remaining-take_points,updated_at=now() WHERE id=lot.id;
                INSERT INTO public.google_one_activation_lot_allocations(job_id,point_lot_id,component,points_amount)
                    VALUES(j.id,lot.id,component,take_points);
                remaining := remaining-take_points;
            END LOOP;
            -- Missing provenance is NOT permission to invent cash-backed lots.
            -- Raising rolls back the job, all lot holds, wallet and ledger together.
            IF remaining>0 THEN RAISE EXCEPTION 'activation_wallet_sources_unavailable'; END IF;
        END LOOP;
        UPDATE public.points_balance SET paid_balance=paid_balance-paid,bonus_balance=bonus_balance-bonus,
            version=version+1,updated_at=now() WHERE user_id=p_user_id AND site=p_site;
        INSERT INTO public.points_ledger(user_id,amount,reason,reference_id,site)
            VALUES(p_user_id,-v_price,'Google One Pro reservation',j.reference_id,p_site);
        RETURN jsonb_build_object('ok',true,'job',to_jsonb(j));
    END IF;
    IF j.id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','activation_not_found'); END IF;
    IF p_action IN ('read','admin_read') THEN RETURN jsonb_build_object('ok',true,'job',to_jsonb(j)); END IF;

    IF p_action IN ('admin_bind','admin_resolve') THEN
        evidence := btrim(p_data->>'evidence_ref');
        IF evidence IS NULL OR evidence !~ '^(https://|ticket:|case:|ref:)[^[:space:]|]{3,230}$' THEN
            RETURN jsonb_build_object('ok',false,'code','invalid_resolution'); END IF;
        target_status := CASE WHEN p_data->>'action'='confirm_success' THEN 'success' WHEN p_data->>'action'='confirm_failed' THEN 'failed' ELSE NULL END;
        -- A stale or repeated administrator action must pass CAS and confirmations too.
        IF (p_data->>'version')::integer IS DISTINCT FROM j.version OR j.status IN ('success','failed','cancelled') THEN
            RETURN jsonb_build_object('ok',false,'code','activation_conflict'); END IF;
        IF j.status='submitting' THEN RETURN jsonb_build_object('ok',false,'code','activation_conflict'); END IF;
        IF p_action='admin_bind' THEN
            IF j.status<>'outcome_unknown' OR j.upstream_task_id IS NOT NULL OR COALESCE((p_data->>'upstream_task_id')::bigint,0)<=0 OR (p_data->>'upstream_task_id')::bigint>9007199254740991 THEN
                RETURN jsonb_build_object('ok',false,'code','activation_conflict'); END IF;
            UPDATE public.google_one_activation_jobs SET upstream_task_id=(p_data->>'upstream_task_id')::bigint,status='queued',review_reason=NULL,
                next_poll_at=now(),version=version+1,updated_at=now() WHERE id=j.id RETURNING * INTO j;
        ELSE
            IF target_status IS NULL OR (target_status='success' AND (COALESCE((p_data->>'pro_confirmed')::boolean,false) IS NOT TRUE OR j.status='prepared'))
                OR (target_status='failed' AND (COALESCE((p_data->>'pro_not_active')::boolean,false) IS NOT TRUE OR COALESCE((p_data->>'upstream_closed')::boolean,false) IS NOT TRUE)) THEN
                RETURN jsonb_build_object('ok',false,'code','invalid_resolution'); END IF;
            needs_refund := target_status='failed' AND j.billing_state='reserved';
            UPDATE public.google_one_activation_jobs SET status=target_status,
                billing_state=CASE WHEN target_status='success' THEN 'charged' ELSE 'refunded' END,
                reviewed_by=p_user_id,reviewed_at=now(),evidence_ref=evidence,review_reason=NULL,version=version+1,updated_at=now()
                WHERE id=j.id RETURNING * INTO j;
        END IF;
        INSERT INTO public.google_one_activation_audit(job_id,actor_id,action,evidence_ref) VALUES(j.id,p_user_id,p_data->>'action',evidence);
    ELSIF j.status IN ('success','failed','cancelled') THEN
        RETURN jsonb_build_object('ok',true,'job',to_jsonb(j)); -- terminal is immutable, including late HTTP responses
    ELSIF p_action IN ('claim_dispatch','claim_poll') THEN
        IF (p_action='claim_dispatch' AND j.status<>'prepared') OR
            (p_action='claim_poll' AND (j.upstream_task_id IS NULL OR j.status NOT IN ('queued','running','outcome_unknown') OR j.next_poll_at>now() OR j.poll_lease_until>now())) THEN
            RETURN jsonb_build_object('ok',true,'claimed',false,'job',to_jsonb(j)); END IF;
        DELETE FROM public.google_one_activation_rate_events WHERE created_at<now()-interval '5 minutes';
        IF (SELECT count(*) FROM public.google_one_activation_rate_events WHERE kind=(CASE WHEN p_action='claim_dispatch' THEN 'submit' ELSE 'poll' END) AND created_at>now()-interval '60 seconds') >= (CASE WHEN p_action='claim_dispatch' THEN 18 ELSE 100 END)
            OR (SELECT count(*) FROM public.google_one_activation_rate_events WHERE kind=(CASE WHEN p_action='claim_dispatch' THEN 'submit' ELSE 'poll' END) AND card_fingerprint=j.card_fingerprint AND created_at>now()-interval '60 seconds') >= (CASE WHEN p_action='claim_dispatch' THEN 5 ELSE 50 END) THEN
            IF p_action='claim_dispatch' THEN RETURN jsonb_build_object('ok',false,'code','activation_rate_limited'); END IF;
            UPDATE public.google_one_activation_jobs SET next_poll_at=now()+interval '30 seconds' WHERE id=j.id RETURNING * INTO j;
            RETURN jsonb_build_object('ok',true,'claimed',false,'job',to_jsonb(j)); END IF;
        INSERT INTO public.google_one_activation_rate_events(kind,card_fingerprint) VALUES((CASE WHEN p_action='claim_dispatch' THEN 'submit' ELSE 'poll' END),j.card_fingerprint);
        IF p_action='claim_dispatch' THEN
            UPDATE public.google_one_activation_jobs SET status='submitting',dispatch_token=(p_data->>'token')::uuid,dispatched_at=now(),version=version+1,updated_at=now()
                WHERE id=j.id RETURNING * INTO j;
        ELSE
            UPDATE public.google_one_activation_jobs SET poll_token=(p_data->>'token')::uuid,poll_lease_until=now()+interval '30 seconds',next_poll_at=now()+interval '10 seconds'
                WHERE id=j.id RETURNING * INTO j;
        END IF;
        RETURN jsonb_build_object('ok',true,'claimed',true,'job',to_jsonb(j));
    ELSIF p_action IN ('submitted','rejected','submission_unknown') THEN
        IF j.dispatch_token IS DISTINCT FROM (p_data->>'token')::uuid OR j.status NOT IN ('submitting','outcome_unknown') OR j.upstream_task_id IS NOT NULL THEN
            RETURN jsonb_build_object('ok',true,'job',to_jsonb(j)); END IF;
        target_status := CASE p_action WHEN 'submitted' THEN 'queued' WHEN 'rejected' THEN 'failed' ELSE 'outcome_unknown' END;
        needs_refund := target_status='failed' AND j.billing_state='reserved';
        UPDATE public.google_one_activation_jobs SET status=target_status,
            billing_state=CASE WHEN needs_refund THEN 'refunded' ELSE billing_state END,
            upstream_task_id=CASE WHEN p_action='submitted' THEN (p_data->>'upstream_task_id')::bigint ELSE upstream_task_id END,
            review_reason=CASE WHEN p_action='submission_unknown' THEN 'submission_unconfirmed' ELSE NULL END,
            next_poll_at=now()+make_interval(secs=>greatest(10,least(86400,COALESCE((p_data->>'retry_seconds')::integer,10)))),version=version+1,updated_at=now()
            WHERE id=j.id RETURNING * INTO j;
    ELSIF p_action='observe' THEN
        IF j.poll_token IS DISTINCT FROM (p_data->>'token')::uuid OR j.status NOT IN ('queued','running','outcome_unknown') THEN
            RETURN jsonb_build_object('ok',true,'job',to_jsonb(j)); END IF;
        upstream_status := (p_data->>'upstream_status')::integer;
        target_status := CASE upstream_status WHEN 1 THEN CASE WHEN j.status='running' THEN 'running' ELSE 'queued' END WHEN 2 THEN 'running'
            WHEN 3 THEN 'verification_pending' WHEN 4 THEN 'verification_pending' WHEN 5 THEN 'verification_pending' ELSE 'outcome_unknown' END;
        retry_seconds := CASE WHEN upstream_status IS NULL THEN greatest(10,least(86400,COALESCE((p_data->>'retry_seconds')::integer,30))) ELSE 10 END;
        -- Provider 3/4/5 are observations, not entitlement/billing evidence.
        needs_refund := false;
        UPDATE public.google_one_activation_jobs SET status=target_status,
            billing_state=CASE WHEN needs_refund THEN 'refunded' ELSE billing_state END,poll_token=NULL,poll_lease_until=NULL,
            next_poll_at=now()+make_interval(secs=>retry_seconds),
            review_reason=CASE WHEN upstream_status=4 THEN 'upstream_failed_unverified' WHEN upstream_status=5 THEN 'upstream_cancelled_unverified' WHEN target_status='verification_pending' THEN 'pro_entitlement_unverified' WHEN upstream_status IS NULL THEN
                CASE WHEN p_data->>'review_reason' IN ('task_not_found','upstream_rate_limited','query_unconfirmed') THEN p_data->>'review_reason' ELSE 'query_unconfirmed' END ELSE NULL END,
            version=version+1,updated_at=now() WHERE id=j.id RETURNING * INTO j;
        -- A long queue/ambiguous result is a review case, never an automatic refund.
        IF j.status IN ('queued','running') AND j.created_at<now()-interval '24 hours' THEN
            UPDATE public.google_one_activation_jobs SET status='outcome_unknown',review_reason='activation_timeout',version=version+1 WHERE id=j.id RETURNING * INTO j;
        END IF;
    ELSIF p_action='card_missing' THEN
        IF j.status='verification_pending' THEN RETURN jsonb_build_object('ok',true,'job',to_jsonb(j)); END IF;
        UPDATE public.google_one_activation_jobs SET status='outcome_unknown',review_reason='original_card_missing',version=version+1,updated_at=now()
            WHERE id=j.id RETURNING * INTO j;
    ELSE
        RETURN jsonb_build_object('ok',false,'code','activation_conflict');
    END IF;
    -- Atomic, idempotent reversal to original paid/bonus buckets AND original lots.
    -- Never mint replacement lots, overwrite provenance or trigger referral rewards.
    IF needs_refund THEN
        PERFORM 1 FROM public.points_balance WHERE user_id=j.user_id AND site=j.site FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'activation_balance_missing'; END IF;
        IF (SELECT coalesce(sum(points_amount),0) FROM public.google_one_activation_lot_allocations WHERE job_id=j.id AND refunded_at IS NULL)<>j.price THEN
            RAISE EXCEPTION 'activation_wallet_sources_unavailable'; END IF;
        FOR allocation IN SELECT a.* FROM public.google_one_activation_lot_allocations a
            JOIN public.wallet_point_lots l ON l.id=a.point_lot_id
            WHERE a.job_id=j.id AND a.refunded_at IS NULL ORDER BY a.component,l.acquired_at,l.created_at,l.id FOR UPDATE OF l
        LOOP
            UPDATE public.wallet_point_lots SET points_remaining=points_remaining+allocation.points_amount,updated_at=now() WHERE id=allocation.point_lot_id;
            UPDATE public.google_one_activation_lot_allocations SET refunded_at=now() WHERE job_id=j.id AND point_lot_id=allocation.point_lot_id;
        END LOOP;
        UPDATE public.points_balance SET paid_balance=paid_balance+j.deducted_paid,bonus_balance=bonus_balance+j.deducted_bonus,
            version=version+1,updated_at=now() WHERE user_id=j.user_id AND site=j.site;
        INSERT INTO public.points_ledger(user_id,amount,reason,reference_id,site)
            VALUES(j.user_id,j.price,'Google One Pro reservation refund',j.reference_id||':refund',j.site);
    END IF;
    RETURN jsonb_build_object('ok',true,'job',to_jsonb(j));
END;
$$;
REVOKE ALL ON FUNCTION public.fn_google_one_activation(text,uuid,uuid,varchar,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_google_one_activation(text,uuid,uuid,varchar,jsonb) TO service_role;
