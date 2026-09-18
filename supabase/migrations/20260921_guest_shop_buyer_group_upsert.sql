-- Guest Shop Order Access 2.0 (A1b): atomic credential-group allocation.
-- Codex does not execute this file. Run it in the target Supabase SQL editor
-- AFTER 20260920_guest_shop_buyer_credentials.sql. Design contract:
-- docs/guest-shop-order-access-2.0.md §6.4 (credential groups), §8.1 (lockout),
-- §9.1 (error semantics), §10.1 (registered_user_match is record-only).
--
-- Why this is a database function and not a sequence of JS round-trips
-- ---------------------------------------------------------------------
-- Group allocation is a read-decide-write on (site, contact_hash). Two
-- concurrent orders from the same email that both read "1 group exists" would
-- both allocate group 2, and the UNIQUE constraint would surface to the buyer
-- as a 500. Worse, the decision depends on whether a group OWNS an order, so
-- it must be evaluated against the same snapshot that performs the insert.
-- One function, one transaction, one advisory lock.
--
-- It is additive: no table is created, altered or dropped, no row is written
-- except the guest_shop_buyers row this call allocates, no guest product or
-- SKU switch is touched, and nothing calls this function until
-- GUEST_SHOP_BUYER_CREDENTIAL_ENABLED is turned on. After this file runs the
-- production behaviour is unchanged.

-- ---------------------------------------------------------------------------
-- 1. fn_guest_shop_upsert_buyer_group
--
--    Implements the five upsert rules of §6.4.2 exactly, in this order:
--
--      matched group given and it exists -> reuse it (NEVER overwrite its
--          password unless the caller passes a hash together with the match,
--          which only happens for the §6.2 transparent parameter upgrade
--          after a SUCCESSFUL verification of that same password);
--      matched group given but the row is gone (concurrent admin delete)
--          -> fall through to allocation, so a buyer is never 500'd by a race;
--      no match, a group owns no order and is older than the recycle cooldown
--          -> recycle the lowest such group (N1: forgetting your password must
--          never become a purchase wall, and a failed/abandoned order must not
--          permanently burn one of the three slots);
--      no match, room left under the cap -> allocate max(group_no)+1;
--      no match, cap reached -> RAISE 'guest_buyer_credential_conflict'.
--
--    N2 (a later buyer must never read an earlier buyer's card secrets) is
--    guaranteed by construction: no code path in this function ever writes
--    p_password_hash onto a row it did not just create, recycle, or match.
--
--    The recycle cooldown exists because group resolution runs BEFORE
--    fn_guest_shop_create_order. For a few seconds a freshly allocated group
--    owns no order yet; recycling inside that window would hand an in-flight
--    order to whoever set the new password. 600s is far longer than any
--    create-order round trip.
--
--    Cap semantics: p_group_cap counts EFFECTIVE groups (owning an order, or
--    younger than the cooldown), not raw rows. The outer bound 5 is enforced
--    by guest_shop_buyers_group_range; the application default (K38) is 3 and
--    is clamped here so a misconfigured env can never exceed the DB bound.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_guest_shop_upsert_buyer_group(
    p_site TEXT,
    p_contact_hash TEXT,
    p_matched_group_no SMALLINT DEFAULT NULL,
    p_password_hash TEXT DEFAULT NULL,
    p_group_cap INTEGER DEFAULT 3,
    p_recycle_cooldown_seconds INTEGER DEFAULT 600,
    p_registered_user_match BOOLEAN DEFAULT NULL
)
RETURNS TABLE (
    buyer_id UUID,
    credential_group_no SMALLINT,
    allocation TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_site TEXT := public.guest_shop_normalize_site(p_site);
    v_hash TEXT := LOWER(BTRIM(COALESCE(p_contact_hash, '')));
    v_cap INTEGER;
    v_cooldown INTEGER;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_cutoff TIMESTAMPTZ;
    v_matched RECORD;
    v_effective INTEGER := 0;
    v_max_group SMALLINT := 0;
    v_recyclable SMALLINT;
    v_next SMALLINT;
BEGIN
    -- Fail closed on garbage input. These are programmer/operator errors, not
    -- buyer errors: the message text is matched by the handler and turned into
    -- a 503 that never reaches the buyer (expose:false), so it is deliberately
    -- a stable token rather than a localised sentence.
    IF v_site NOT IN ('cn', 'intl') THEN
        RAISE EXCEPTION 'guest_buyer_site_invalid' USING ERRCODE = '22023';
    END IF;
    IF v_hash !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'guest_buyer_contact_required' USING ERRCODE = '22023';
    END IF;
    -- Same alphabet the column CHECK enforces. Validating here turns a would-be
    -- 23514 constraint violation (an opaque 500) into a named, testable error.
    IF p_password_hash IS NOT NULL
       AND p_password_hash !~ '^scrypt\$[0-9]+\$[0-9]+\$[0-9]+\$norm=v[0-9]+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$' THEN
        RAISE EXCEPTION 'guest_buyer_password_malformed' USING ERRCODE = '22023';
    END IF;

    v_cap := LEAST(5, GREATEST(1, COALESCE(p_group_cap, 3)));
    v_cooldown := LEAST(86400, GREATEST(0, COALESCE(p_recycle_cooldown_seconds, 600)));

    -- Serialise every allocation for this (site, contact_hash). Same primitive
    -- fn_guest_shop_create_order already uses for idempotency keys
    -- (20260913_guest_shop_atomic_rpcs.sql:1583). Held to end of transaction.
    PERFORM pg_advisory_xact_lock(hashtextextended(v_site || ':' || v_hash, 0));

    -- -----------------------------------------------------------------------
    -- Rule 3: a verified match reuses its group.
    -- -----------------------------------------------------------------------
    IF p_matched_group_no IS NOT NULL THEN
        SELECT b.id, b.credential_group_no, b.password_hash, b.password_version
          INTO v_matched
          FROM public.guest_shop_buyers b
         WHERE b.site = v_site
           AND b.contact_hash = v_hash
           AND b.credential_group_no = p_matched_group_no
         FOR UPDATE OF b;

        IF FOUND THEN
            IF p_password_hash IS NOT NULL AND p_password_hash <> v_matched.password_hash THEN
                -- §6.2 transparent upgrade. Only reachable together with a
                -- verified match, so re-minting the hash for the SAME password
                -- cannot lock the buyer out. password_version is monotonic.
                UPDATE public.guest_shop_buyers b
                   SET password_hash = p_password_hash,
                       password_version = LEAST(32767, COALESCE(v_matched.password_version, 1) + 1)::SMALLINT,
                       password_updated_at = v_now,
                       updated_at = v_now
                 WHERE b.id = v_matched.id;
            END IF;
            -- last_login_at / last_login_ip_hash are deliberately NOT written
            -- here: the order path has no IP hash to pair with the timestamp,
            -- and a half-populated "last login" would mislead the A3 admin
            -- unlock screen. The login path (A2) owns those two columns.
            buyer_id := v_matched.id;
            credential_group_no := v_matched.credential_group_no;
            allocation := 'reused';
            RETURN NEXT;
            RETURN;
        END IF;
        -- Matched row vanished under us. Fall through and allocate; refusing
        -- here would turn an admin cleanup into a buyer-facing failure.
    END IF;

    -- Allocation always mints a password. A NULL hash with no match means the
    -- caller skipped verification, which is a handler bug, not a buyer error.
    IF p_password_hash IS NULL THEN
        RAISE EXCEPTION 'guest_buyer_password_required' USING ERRCODE = '22023';
    END IF;

    v_cutoff := v_now - make_interval(secs => v_cooldown);

    -- One pass over the (at most 5) rows of this contact. "Effective" = owns an
    -- order, or is still inside the recycle cooldown window. EXISTS is used
    -- instead of a denormalised counter because a counter drifts and then lies.
    SELECT
        COUNT(*) FILTER (WHERE t.owns_orders OR t.created_at > v_cutoff),
        COALESCE(MAX(t.grp), 0)::SMALLINT,
        MIN(t.grp) FILTER (WHERE NOT (t.owns_orders OR t.created_at > v_cutoff))
      INTO v_effective, v_max_group, v_recyclable
      FROM (
          SELECT
              b.credential_group_no AS grp,
              b.created_at,
              EXISTS (
                  SELECT 1 FROM public.guest_shop_orders o WHERE o.buyer_id = b.id
              ) AS owns_orders
            FROM public.guest_shop_buyers b
           WHERE b.site = v_site
             AND b.contact_hash = v_hash
      ) t;

    -- -----------------------------------------------------------------------
    -- Rule 4a: recycle an orphan group. Resets every credential and lock field
    -- because this slot now belongs to a DIFFERENT person; leaving the old
    -- failed_login_count or locked_until behind would let an attacker lock a
    -- slot they do not own, and leaving merged_into_user_id behind would link
    -- the new buyer's orders to somebody else's account.
    -- -----------------------------------------------------------------------
    IF v_recyclable IS NOT NULL THEN
        UPDATE public.guest_shop_buyers b
           SET password_hash = p_password_hash,
               password_version = 1,
               password_updated_at = v_now,
               email_verified_at = NULL,
               registered_user_match = COALESCE(p_registered_user_match, false),
               failed_login_count = 0,
               login_lock_stage = 0,
               locked_until = NULL,
               last_login_at = NULL,
               last_login_ip_hash = NULL,
               merged_into_user_id = NULL,
               merged_at = NULL,
               -- Restart the cooldown clock for this slot.
               created_at = v_now,
               updated_at = v_now
         WHERE b.site = v_site
           AND b.contact_hash = v_hash
           AND b.credential_group_no = v_recyclable
        RETURNING b.id, b.credential_group_no INTO buyer_id, credential_group_no;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'guest_buyer_credential_conflict' USING ERRCODE = '23505';
        END IF;
        allocation := 'recycled';
        RETURN NEXT;
        RETURN;
    END IF;

    -- -----------------------------------------------------------------------
    -- Rule 5: cap reached. This is the ONE observable outcome on the order path
    -- (§9.1) and the cost an attacker pays for it is the shared failure budget
    -- in api/_lib/guest-shop/buyer-credentials.js (§8.1).
    -- -----------------------------------------------------------------------
    IF v_effective >= v_cap THEN
        RAISE EXCEPTION 'guest_buyer_credential_conflict' USING ERRCODE = '23505';
    END IF;

    -- -----------------------------------------------------------------------
    -- Rule 4b: allocate the next group number. DO NOTHING is belt and braces
    -- behind the advisory lock; if it ever fires, the caller gets the
    -- documented 409 rather than a duplicate-key 500.
    --
    -- The conflict target names the CONSTRAINT, not the columns. A column list
    -- here is parsed as expressions, so `credential_group_no` would collide
    -- with the RETURNS TABLE output variable of the same name and PostgreSQL
    -- rejects the body with "column reference is ambiguous" at first call.
    -- Naming the constraint is unambiguous and is itself asserted by the paired
    -- verify script, so renaming the constraint cannot silently disable it.
    -- -----------------------------------------------------------------------
    v_next := (v_max_group + 1)::SMALLINT;
    IF v_next < 1 OR v_next > 5 THEN
        RAISE EXCEPTION 'guest_buyer_credential_conflict' USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.guest_shop_buyers AS b (
        site,
        contact_hash,
        credential_group_no,
        password_hash,
        password_version,
        password_updated_at,
        registered_user_match
    ) VALUES (
        v_site,
        v_hash,
        v_next,
        p_password_hash,
        1,
        v_now,
        -- §10.1 / anti-price-discrimination H1-H4: record-only, never a pricing
        -- or quota input. The public order path always passes NULL, so this
        -- stays false; A3/A4 populate it from an authenticated surface.
        COALESCE(p_registered_user_match, false)
    )
    ON CONFLICT ON CONSTRAINT guest_shop_buyers_site_contact_group_uniq DO NOTHING
    RETURNING b.id, b.credential_group_no INTO buyer_id, credential_group_no;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'guest_buyer_credential_conflict' USING ERRCODE = '23505';
    END IF;

    allocation := 'created';
    RETURN NEXT;
    RETURN;
END;
$$;

COMMENT ON FUNCTION public.fn_guest_shop_upsert_buyer_group(TEXT, TEXT, SMALLINT, TEXT, INTEGER, INTEGER, BOOLEAN) IS
    'Order Access 2.0 §6.4: atomically reuse, recycle or allocate a guest credential group. Never overwrites an unmatched group password (N2 anti card-secret-cross-leak). Access control only: never a pricing or quota input.';

REVOKE ALL ON FUNCTION public.fn_guest_shop_upsert_buyer_group(TEXT, TEXT, SMALLINT, TEXT, INTEGER, INTEGER, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_upsert_buyer_group(TEXT, TEXT, SMALLINT, TEXT, INTEGER, INTEGER, BOOLEAN) TO service_role;
