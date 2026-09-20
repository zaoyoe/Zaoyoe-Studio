-- Guest Shop Order Access 2.1: bounded retention cleanup for access-attempt
-- audit rows. Codex does not execute this file.
--
-- Applying this migration does not schedule a job, enable buyer credentials,
-- enable a guest product, or delete data. The existing KVM4 guest-shop worker
-- calls the function only while the independent
-- GUEST_SHOP_BUYER_ACCESS_AUDIT_RETENTION_ENABLED switch is on.

-- The original per-IP and per-contact indexes cannot serve a global
-- created_at cutoff because created_at is not their leading column. This index
-- keeps an empty retention sweep an index-range lookup instead of a table scan.
CREATE INDEX IF NOT EXISTS guest_shop_access_attempts_retention_idx
    ON public.guest_shop_access_attempts (created_at ASC, id ASC);

CREATE OR REPLACE FUNCTION public.fn_guest_shop_purge_access_attempts(
    p_cutoff TIMESTAMPTZ,
    p_limit INTEGER DEFAULT 1000
)
RETURNS TABLE (deleted_count INTEGER, has_more BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_limit INTEGER;
BEGIN
    -- ACLs are the outer boundary; every guest-shop writer also enforces the
    -- caller role inside the SECURITY DEFINER body.
    PERFORM public.guest_shop_require_service_role();

    -- Serialize purge callers across worker processes. Without this lock, two
    -- SKIP LOCKED scans could each report their visible slice as drained while
    -- the other transaction still owns older rows.
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('guest_shop_access_attempt_retention', 0)
    );

    IF p_cutoff IS NULL THEN
        RAISE EXCEPTION 'guest_access_audit_cutoff_required'
            USING ERRCODE = '22023';
    END IF;

    -- The worker uses 1000. The database cap prevents a buggy or misconfigured
    -- RPC invocation from widening one sweep into an unbounded delete. It is
    -- not a containment boundary for a compromised service-role credential,
    -- which already has direct table privileges.
    v_limit := LEAST(GREATEST(COALESCE(p_limit, 1000), 1), 1000);

    RETURN QUERY
    WITH candidates AS MATERIALIZED (
        SELECT a.id, a.created_at
        FROM public.guest_shop_access_attempts AS a
        WHERE a.created_at < p_cutoff
        ORDER BY a.created_at ASC, a.id ASC
        -- Lock one bounded look-ahead row so the caller can distinguish a
        -- drained queue from a full batch without a separate COUNT scan.
        LIMIT (v_limit + 1)
        FOR UPDATE SKIP LOCKED
    ), victims AS (
        SELECT c.id
        FROM candidates AS c
        ORDER BY c.created_at ASC, c.id ASC
        LIMIT v_limit
    ), deleted AS (
        DELETE FROM public.guest_shop_access_attempts AS a
        USING victims AS v
        WHERE a.id = v.id
        RETURNING a.id
    )
    SELECT
        (SELECT COUNT(*)::INTEGER FROM deleted),
        (SELECT COUNT(*) > v_limit FROM candidates);
END;
$$;

ALTER FUNCTION public.fn_guest_shop_purge_access_attempts(TIMESTAMPTZ, INTEGER)
    OWNER TO postgres;

COMMENT ON FUNCTION public.fn_guest_shop_purge_access_attempts(TIMESTAMPTZ, INTEGER) IS
    'Deletes at most 1000 guest access-attempt audit rows older than the caller-provided retention cutoff and reports bounded backlog. Service-role worker only.';

REVOKE ALL ON FUNCTION public.fn_guest_shop_purge_access_attempts(TIMESTAMPTZ, INTEGER)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_purge_access_attempts(TIMESTAMPTZ, INTEGER)
    TO service_role;
