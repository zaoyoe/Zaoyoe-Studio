-- Verify Guest Shop Order Access 2.0 (A1b): credential-group allocation RPC.
-- Codex does not execute this file. Run it in the target Supabase SQL editor
-- AFTER 20260921_guest_shop_buyer_group_upsert.sql. Read-only: it creates
-- nothing, mutates nothing, prints no password hash, no contact hash and no
-- plaintext email, and does not roll back 20260913..20260920.
--
-- Every row must be PASS. Any FAIL means the migration was applied partially,
-- or an older migration was re-run on top of it. Do NOT enable
-- GUEST_SHOP_BUYER_CREDENTIAL_ENABLED until all rows pass.
--
-- Assertions are STRUCTURAL, never row counts: a count-based check would only
-- be true in the instant after the migration and would start reporting a false
-- FAIL as soon as real guest orders exist. Operators re-run verify scripts.

WITH fn AS (
    SELECT
        p.oid,
        COALESCE(p.prosecdef, false) AS security_definer,
        COALESCE(p.provolatile, '') AS provolatile,
        COALESCE(p.proconfig, ARRAY[]::TEXT[]) AS proconfig,
        COALESCE(p.proargnames, ARRAY[]::TEXT[]) AS proargnames,
        COALESCE(p.proargmodes, ARRAY[]::TEXT[]) AS proargmodes,
        array_length(p.proargtypes, 1) AS arity,
        pg_get_function_result(p.oid) AS result_type,
        pg_get_functiondef(p.oid) AS def
    FROM pg_proc p
    WHERE p.oid = to_regprocedure(
        'public.fn_guest_shop_upsert_buyer_group(text, text, smallint, text, integer, integer, boolean)'
    )
), fn_overloads AS (
    SELECT COUNT(*) AS n
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname = 'fn_guest_shop_upsert_buyer_group'
), fn_grants AS (
    SELECT g.grantee, g.privilege_type, r.rolname
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) g
    LEFT JOIN pg_roles r ON r.oid = g.grantee
    WHERE p.oid = to_regprocedure(
        'public.fn_guest_shop_upsert_buyer_group(text, text, smallint, text, integer, integer, boolean)'
    )
), buyers_columns AS (
    SELECT a.attname AS column_name
    FROM pg_attribute a
    WHERE a.attrelid = to_regclass('public.guest_shop_buyers')
      AND a.attnum > 0
      AND NOT a.attisdropped
), checks AS (
    SELECT
        1 AS sort_order,
        'upsert_fn_present_and_unique'::TEXT AS check_name,
        jsonb_build_object(
            'present', EXISTS (SELECT 1 FROM fn),
            'overload_count', (SELECT n FROM fn_overloads)
        ) AS observed,
        jsonb_build_object(
            'present', true,
            -- Exactly one overload: a second one would make every named-parameter
            -- call from PostgREST ambiguous, which is the same trap the A0
            -- exact-signature DROP was written to avoid.
            'overload_count', 1
        ) AS expected
    UNION ALL
    SELECT
        2,
        'upsert_fn_signature',
        jsonb_build_object(
            'arity', (SELECT arity FROM fn),
            'in_params_match', (
                -- WITH ORDINALITY puts the element first and the position second.
                -- Comparing position by position (not "is it present somewhere")
                -- is what pins the PostgREST named-parameter contract.
                SELECT COALESCE(bool_and(fn.proargnames[x.pos] = x.name), false)
                FROM unnest(ARRAY[
                    'p_site', 'p_contact_hash', 'p_matched_group_no', 'p_password_hash',
                    'p_group_cap', 'p_recycle_cooldown_seconds', 'p_registered_user_match'
                ]) WITH ORDINALITY AS x(name, pos)
                CROSS JOIN fn
            ),
            'returns_buyer_id', (SELECT COALESCE(result_type ~ 'buyer_id', false) FROM fn),
            'returns_group_no', (SELECT COALESCE(result_type ~ 'credential_group_no', false) FROM fn),
            'returns_allocation', (SELECT COALESCE(result_type ~ 'allocation', false) FROM fn),
            'is_set_returning', (SELECT COALESCE(result_type ~ 'TABLE', false) FROM fn)
        ),
        jsonb_build_object(
            'arity', 7,
            'in_params_match', true,
            'returns_buyer_id', true,
            'returns_group_no', true,
            'returns_allocation', true,
            'is_set_returning', true
        )
    UNION ALL
    SELECT
        3,
        'upsert_fn_security_posture',
        jsonb_build_object(
            'security_definer', (SELECT COALESCE(bool_and(security_definer), false) FROM fn),
            'search_path_pinned', (
                SELECT COALESCE(bool_and(EXISTS (
                    SELECT 1 FROM unnest(proconfig) cfg WHERE cfg = 'search_path=public, pg_temp'
                )), false)
                FROM fn
            ),
            'not_immutable', (SELECT COALESCE(bool_and(provolatile <> 'i'), false) FROM fn)
        ),
        jsonb_build_object(
            'security_definer', true,
            'search_path_pinned', true,
            'not_immutable', true
        )
    UNION ALL
    SELECT
        4,
        'upsert_fn_grants',
        jsonb_build_object(
            'service_role_execute', EXISTS (
                SELECT 1 FROM fn_grants WHERE rolname = 'service_role' AND privilege_type = 'EXECUTE'
            ),
            'anon_execute', EXISTS (
                SELECT 1 FROM fn_grants WHERE rolname = 'anon' AND privilege_type = 'EXECUTE'
            ),
            'authenticated_execute', EXISTS (
                SELECT 1 FROM fn_grants WHERE rolname = 'authenticated' AND privilege_type = 'EXECUTE'
            ),
            'public_execute', EXISTS (
                SELECT 1 FROM fn_grants WHERE grantee = 0 AND privilege_type = 'EXECUTE'
            )
        ),
        jsonb_build_object(
            'service_role_execute', true,
            'anon_execute', false,
            'authenticated_execute', false,
            'public_execute', false
        )
    UNION ALL
    -- N2 anti card-secret-cross-leak, asserted from the function body. These are
    -- the invariants that make "a later buyer can never read an earlier buyer's
    -- card secrets" true. If any of them disappears, the RPC has been rewritten
    -- into a takeover primitive and guest checkout must stay disabled.
    SELECT
        5,
        'upsert_fn_body_guarantees',
        jsonb_build_object(
            'advisory_lock_serialises_contact', (
                SELECT COALESCE(bool_and(def ~ 'pg_advisory_xact_lock\(hashtextextended\('), false) FROM fn
            ),
            'cap_conflict_token_present', (
                SELECT COALESCE(bool_and(def ~ 'guest_buyer_credential_conflict'), false) FROM fn
            ),
            'contact_hash_validated', (
                SELECT COALESCE(bool_and(def ~ 'guest_buyer_contact_required'), false) FROM fn
            ),
            'password_format_validated', (
                SELECT COALESCE(bool_and(def ~ 'guest_buyer_password_malformed'), false) FROM fn
            ),
            'effective_group_uses_exists_not_counter', (
                SELECT COALESCE(bool_and(
                    def ~ 'EXISTS' AND def ~ 'guest_shop_orders' AND def !~ 'order_count'
                ), false) FROM fn
            ),
            'recycle_cooldown_applied', (
                SELECT COALESCE(bool_and(def ~ 'make_interval\(secs =>'), false) FROM fn
            ),
            'insert_never_upserts', (
                -- ON CONFLICT ... DO UPDATE would overwrite an existing group's
                -- password, which is exactly the takeover N2 forbids. The
                -- constraint-named target is asserted literally so a rename of
                -- guest_shop_buyers_site_contact_group_uniq fails this check
                -- instead of silently turning the insert into a plain error.
                SELECT COALESCE(bool_and(
                    def ~ 'ON CONFLICT ON CONSTRAINT guest_shop_buyers_site_contact_group_uniq DO NOTHING'
                    AND def !~ 'ON CONFLICT[^;]*DO UPDATE'
                ), false) FROM fn
            ),
            'registered_match_written_as_record', (
                SELECT COALESCE(bool_and(
                    def ~ 'registered_user_match = COALESCE\(p_registered_user_match'
                ), false) FROM fn
            ),
            'registered_match_never_a_predicate', (
                -- It may be WRITTEN (record-only) but must never become a filter,
                -- a comparison or a branch condition: that is what would turn it
                -- into a pricing or eligibility input (anti-price-discrimination
                -- H2, promo plan §22.5). `IF ... THEN` is deliberately NOT
                -- matched as a whole, because the recycle UPDATE legitimately
                -- sits inside an IF block and assigns the column in its SET list.
                SELECT COALESCE(bool_and(
                    def !~ 'AND[[:space:]]+[a-z_]*\.?registered_user_match'
                    AND def !~ 'registered_user_match[[:space:]]*(=|<>|!=)[[:space:]]*(true|false)'
                    AND def !~ 'registered_user_match[[:space:]]+IS[[:space:]]'
                    AND def !~ 'CASE[[:space:]]+WHEN[^;]*registered_user_match'
                ), false) FROM fn
            )
        ),
        jsonb_build_object(
            'advisory_lock_serialises_contact', true,
            'cap_conflict_token_present', true,
            'contact_hash_validated', true,
            'password_format_validated', true,
            'effective_group_uses_exists_not_counter', true,
            'recycle_cooldown_applied', true,
            'insert_never_upserts', true,
            'registered_match_written_as_record', true,
            'registered_match_never_a_predicate', true
        )
    UNION ALL
    -- A1b is additive. It must not have reshaped the A0 schema on the way in.
    SELECT
        6,
        'a1b_is_additive',
        jsonb_build_object(
            'buyers_table_present', to_regclass('public.guest_shop_buyers') IS NOT NULL,
            'no_new_buyers_columns', NOT EXISTS (
                SELECT 1 FROM buyers_columns c
                WHERE c.column_name NOT IN (
                    'id', 'site', 'contact_hash', 'credential_group_no', 'password_hash',
                    'password_version', 'password_updated_at', 'email_verified_at',
                    'registered_user_match', 'failed_login_count', 'login_lock_stage',
                    'locked_until', 'last_login_at', 'last_login_ip_hash',
                    'merged_into_user_id', 'merged_at', 'created_at', 'updated_at'
                )
            ),
            'group_unique_still_present', EXISTS (
                SELECT 1 FROM pg_constraint c
                WHERE c.conrelid = to_regclass('public.guest_shop_buyers')
                  AND c.conname = 'guest_shop_buyers_site_contact_group_uniq'
            ),
            'buyers_rls_still_enabled', (
                SELECT COALESCE(bool_and(relrowsecurity), false)
                FROM pg_class WHERE oid = to_regclass('public.guest_shop_buyers')
            ),
            'no_trigger_added_to_buyers', NOT EXISTS (
                SELECT 1 FROM pg_trigger t
                WHERE t.tgrelid = to_regclass('public.guest_shop_buyers')
                  AND NOT t.tgisinternal
            ),
            'no_purge_job_created', NOT EXISTS (
                SELECT 1 FROM pg_proc p
                WHERE p.pronamespace = 'public'::regnamespace
                  AND p.proname ~* 'guest_shop.*purge|purge.*guest_shop_buyer'
            ),
            -- Era-aware -- 2026-09-23 probe correction. This key used to be
            -- `create_order_rpc_still_13_params` and pinned the A0 signature
            -- exactly. `20260923_guest_shop_promo_l1l2.sql` (promo L1/L2) DROPs
            -- that overload and installs 15 parameters, so the pinned probe
            -- reported a FALSE FAIL against a correct database. A1b's real
            -- invariant is "create_order still exists and stays callable", which
            -- is era-independent; WHICH signature is current is pinned by
            -- 20260923_verify_guest_shop_promo_l1l2.sql
            -- (function_arity_single_overload). A shape that belongs to neither
            -- era keeps this row red, and a new era must be added here in the
            -- same commit that introduces it
            -- (tests/guest-shop-create-order-signature-compat.test.js enforces it).
            'create_order_rpc_known_signature', (
                to_regprocedure('public.fn_guest_shop_create_order(text, uuid, uuid, text, text, text, text, text, text, uuid, text, text, integer)') IS NOT NULL
                OR to_regprocedure('public.fn_guest_shop_create_order(text, uuid, uuid, text, text, text, text, text, text, uuid, text, text, integer, integer, text)') IS NOT NULL
            )
        ),
        jsonb_build_object(
            'buyers_table_present', true,
            'no_new_buyers_columns', true,
            'group_unique_still_present', true,
            'buyers_rls_still_enabled', true,
            'no_trigger_added_to_buyers', true,
            'no_purge_job_created', true,
            'create_order_rpc_known_signature', true
        )
)
SELECT
    sort_order,
    check_name,
    observed,
    expected,
    CASE
        WHEN observed = expected THEN 'PASS'
        ELSE 'FAIL'
    END AS status
FROM checks
ORDER BY sort_order;
