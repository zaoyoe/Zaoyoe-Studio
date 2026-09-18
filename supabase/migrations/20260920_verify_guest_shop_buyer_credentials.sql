-- Verify Guest Shop Order Access 2.0 (A0): buyer credential tables + buyer_id.
-- Codex does not execute this file. Run it in the target Supabase SQL editor
-- after 20260920_guest_shop_buyer_credentials.sql. This script is read-only:
-- it does not enable guest products, does not mutate orders, does not print any
-- password hash or contact hash value, and does not rollback
-- 20260913/14/15/16/17/18/19.
--
-- Constraint matching uses constraint NAMES plus regular expressions instead of
-- exact pg_get_constraintdef strings, because PostgreSQL canonicalises CHECK
-- bodies (for example `BETWEEN 1 AND 5` is dumped as `>= 1 AND <= 5`) and an
-- exact-match verify script would report a false FAIL.
--
-- RULE FOR PROBE AUTHORS (learned from a real false FAIL on 2026-09-18):
-- when the definition being probed itself STORES REGEX SOURCE -- here
-- `guest_shop_buyers_pwd_format` and `guest_shop_buyers_hash_check`, and in
-- 20260922 `guest_shop_access_resets_token_check` -- match it with a LITERAL
-- probe (strpos() / LIKE), never with `~`.  `def ~ 'norm=v[0-9]+'` reads
-- `[0-9]` as a character class and therefore demands a digit right after
-- `norm=v`, while the stored text is the twelve characters `norm=v[0-9]+`; the
-- probe can never match and the row reports FAIL even though the migration is
-- correct.  Literal needles also avoid backslashes entirely, so they are immune
-- to standard_conforming_strings differences.
-- `tests/guest-shop-verify-probe-contract.test.js` replays every probe in this
-- file against the real migration text and fails if the rule is broken again.
--
-- Every row must be PASS. Any FAIL means the migration was applied partially or
-- an older migration was re-run on top of it; do NOT enable
-- GUEST_SHOP_BUYER_CREDENTIAL_ENABLED until all rows pass.

WITH buyers_columns AS (
    SELECT a.attname AS column_name
    FROM pg_attribute a
    WHERE a.attrelid = to_regclass('public.guest_shop_buyers')
      AND a.attnum > 0
      AND NOT a.attisdropped
), buyers_constraints AS (
    SELECT c.conname, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    WHERE c.conrelid = to_regclass('public.guest_shop_buyers')
), buyers_indexes AS (
    SELECT i.indexname
    FROM pg_indexes i
    WHERE i.schemaname = 'public'
      AND i.tablename = 'guest_shop_buyers'
), attempts_constraints AS (
    SELECT c.conname, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    WHERE c.conrelid = to_regclass('public.guest_shop_access_attempts')
), attempts_indexes AS (
    SELECT i.indexname
    FROM pg_indexes i
    WHERE i.schemaname = 'public'
      AND i.tablename = 'guest_shop_access_attempts'
), orders_constraints AS (
    SELECT c.conname, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    WHERE c.conrelid = to_regclass('public.guest_shop_orders')
      AND c.contype = 'f'
      AND c.confrelid = to_regclass('public.guest_shop_buyers')
), rls_rows AS (
    SELECT c.relname, c.relrowsecurity
    FROM pg_class c
    WHERE c.oid = to_regclass('public.guest_shop_buyers')
       OR c.oid = to_regclass('public.guest_shop_access_attempts')
), fn AS (
    SELECT
        p.oid,
        COALESCE(p.prosecdef, false) AS security_definer,
        COALESCE(p.proconfig, ARRAY[]::TEXT[]) AS proconfig,
        COALESCE(p.proargnames, ARRAY[]::TEXT[]) AS proargnames,
        array_length(p.proargtypes, 1) AS arity,
        pg_get_functiondef(p.oid) AS def
    FROM pg_proc p
    WHERE p.oid = to_regprocedure(
        'public.fn_guest_shop_create_order(text, uuid, uuid, text, text, text, text, text, text, uuid, text, text, integer)'
    )
), fn_grants AS (
    SELECT g.grantee, g.privilege_type, r.rolname
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) g
    LEFT JOIN pg_roles r ON r.oid = g.grantee
    WHERE p.oid = to_regprocedure(
        'public.fn_guest_shop_create_order(text, uuid, uuid, text, text, text, text, text, text, uuid, text, text, integer)'
    )
), checks AS (
    SELECT
        1 AS sort_order,
        'buyer_tables_present'::TEXT AS check_name,
        jsonb_build_object(
            'guest_shop_buyers', (to_regclass('public.guest_shop_buyers') IS NOT NULL),
            'guest_shop_access_attempts', (to_regclass('public.guest_shop_access_attempts') IS NOT NULL)
        ) AS observed,
        jsonb_build_object(
            'guest_shop_buyers', true,
            'guest_shop_access_attempts', true
        ) AS expected
    UNION ALL
    SELECT
        2,
        'buyers_columns',
        jsonb_build_object(
            'missing_columns', (
                SELECT COALESCE(jsonb_agg(x ORDER BY x), '[]'::jsonb)
                FROM unnest(ARRAY[
                    'site', 'contact_hash', 'credential_group_no', 'password_hash',
                    'password_version', 'password_updated_at', 'email_verified_at',
                    'registered_user_match', 'failed_login_count', 'login_lock_stage',
                    'locked_until', 'last_login_at', 'last_login_ip_hash',
                    'merged_into_user_id', 'merged_at', 'created_at', 'updated_at'
                ]) AS x
                WHERE NOT EXISTS (SELECT 1 FROM buyers_columns c WHERE c.column_name = x)
            ),
            'unexpected_denormalised_columns', (
                SELECT COALESCE(jsonb_agg(x ORDER BY x), '[]'::jsonb)
                FROM unnest(ARRAY['order_count']) AS x
                WHERE EXISTS (SELECT 1 FROM buyers_columns c WHERE c.column_name = x)
            )
        ),
        jsonb_build_object(
            'missing_columns', '[]'::jsonb,
            'unexpected_denormalised_columns', '[]'::jsonb
        )
    UNION ALL
    SELECT
        3,
        'buyers_constraints',
        jsonb_build_object(
            'missing_constraints', (
                SELECT COALESCE(jsonb_agg(x ORDER BY x), '[]'::jsonb)
                FROM unnest(ARRAY[
                    'guest_shop_buyers_pkey',
                    'guest_shop_buyers_site_check',
                    'guest_shop_buyers_hash_check',
                    'guest_shop_buyers_pwd_format',
                    'guest_shop_buyers_pwd_version',
                    'guest_shop_buyers_attempts',
                    'guest_shop_buyers_stage',
                    'guest_shop_buyers_group_range',
                    'guest_shop_buyers_site_contact_group_uniq'
                ]) AS x
                WHERE NOT EXISTS (SELECT 1 FROM buyers_constraints c WHERE c.conname = x)
            ),
            'group_unique_covers_site_contact_group', (
                SELECT COALESCE(bool_and(
                    def ~ 'UNIQUE'
                    AND def ~ 'site'
                    AND def ~ 'contact_hash'
                    AND def ~ 'credential_group_no'
                ), false)
                FROM buyers_constraints
                WHERE conname = 'guest_shop_buyers_site_contact_group_uniq'
            ),
            'group_range_upper_bound_at_least_app_cap', (
                -- Numeric extraction, not a character-class probe.  The rule is
                -- "DB cap >= application cap (K38, default 3)", so a two-digit
                -- cap such as 10 must also pass; `<= [3-9]` would have failed
                -- it.  A missing match yields NULL -> COALESCE 0 -> false, i.e.
                -- fail-closed.
                SELECT COALESCE(bool_and(
                    def ~ 'credential_group_no >= 1'
                    AND COALESCE((substring(def from '<= *([0-9]+)'))::int, 0) >= 3
                ), false)
                FROM buyers_constraints
                WHERE conname = 'guest_shop_buyers_group_range'
            ),
            'password_format_pins_scrypt_and_norm_version', (
                -- LITERAL probes on purpose: this CHECK stores regex source, so
                -- a `~` probe would misread `[0-9]+` as a character class and
                -- report a false FAIL.  See the RULE in the file header.
                SELECT COALESCE(bool_and(
                    strpos(def, 'scrypt') > 0
                    AND strpos(def, 'password_hash') > 0
                    AND strpos(def, 'norm=v[0-9]+') > 0
                    AND strpos(def, '[A-Za-z0-9+/=]+') > 0
                ), false)
                FROM buyers_constraints
                WHERE conname = 'guest_shop_buyers_pwd_format'
            ),
            'contact_hash_format_is_64_hex', (
                -- LITERAL probe: this CHECK also stores regex source, so a `~`
                -- probe is a trap for the next editor (see the header RULE).
                -- Pinning the whole class additionally proves the 64-hex length
                -- bound, which the retired `~ '0-9a-f'` probe did not.  The
                -- spelling is proven against a real pg_get_constraintdef by the
                -- already-passing sibling check
                -- `resets_constraints.token_hash_is_sha256_hex_shape` in
                -- 20260922_verify_guest_shop_access_resets.sql.
                SELECT COALESCE(bool_and(
                    strpos(def, 'contact_hash') > 0
                    AND strpos(def, '[0-9a-f]{64}') > 0
                ), false)
                FROM buyers_constraints
                WHERE conname = 'guest_shop_buyers_hash_check'
            )
        ),
        jsonb_build_object(
            'missing_constraints', '[]'::jsonb,
            'group_unique_covers_site_contact_group', true,
            'group_range_upper_bound_at_least_app_cap', true,
            'password_format_pins_scrypt_and_norm_version', true,
            'contact_hash_format_is_64_hex', true
        )
    UNION ALL
    SELECT
        4,
        'buyers_indexes',
        jsonb_build_object(
            'indexes', (SELECT COALESCE(jsonb_agg(indexname ORDER BY indexname), '[]'::jsonb) FROM buyers_indexes)
        ),
        jsonb_build_object(
            'indexes', '["guest_shop_buyers_contact_idx", "guest_shop_buyers_locked_idx", "guest_shop_buyers_pkey", "guest_shop_buyers_site_contact_group_uniq"]'::jsonb
        )
    UNION ALL
    SELECT
        5,
        'access_attempts_shape',
        jsonb_build_object(
            'missing_constraints', (
                SELECT COALESCE(jsonb_agg(x ORDER BY x), '[]'::jsonb)
                FROM unnest(ARRAY[
                    'guest_shop_access_attempts_pkey',
                    'guest_shop_access_attempts_site_check',
                    'guest_shop_access_attempts_ip_check',
                    'guest_shop_access_attempts_outcome_check'
                ]) AS x
                WHERE NOT EXISTS (SELECT 1 FROM attempts_constraints c WHERE c.conname = x)
            ),
            'outcome_allows_credential_conflict', (
                SELECT COALESCE(bool_and(def ~ 'credential_conflict'), false)
                FROM attempts_constraints
                WHERE conname = 'guest_shop_access_attempts_outcome_check'
            ),
            'indexes', (SELECT COALESCE(jsonb_agg(indexname ORDER BY indexname), '[]'::jsonb) FROM attempts_indexes)
        ),
        jsonb_build_object(
            'missing_constraints', '[]'::jsonb,
            'outcome_allows_credential_conflict', true,
            'indexes', '["guest_shop_access_attempts_contact_idx", "guest_shop_access_attempts_ip_idx", "guest_shop_access_attempts_pkey"]'::jsonb
        )
    UNION ALL
    -- The two new tables hold scrypt password hashes and HMAC contact hashes.
    -- Supabase default privileges would otherwise expose them to anon through
    -- PostgREST, and the realtime publication would broadcast them. Both must
    -- be closed. There must be no browser-facing policy on either table.
    SELECT
        6,
        'rls_and_privileges_closed',
        jsonb_build_object(
            'buyers_rls_enabled', (SELECT COALESCE(bool_and(relrowsecurity), false) FROM rls_rows WHERE relname = 'guest_shop_buyers'),
            'attempts_rls_enabled', (SELECT COALESCE(bool_and(relrowsecurity), false) FROM rls_rows WHERE relname = 'guest_shop_access_attempts'),
            'anon_select_buyers', (
                CASE WHEN to_regclass('public.guest_shop_buyers') IS NULL THEN NULL
                     ELSE has_table_privilege('anon', 'public.guest_shop_buyers', 'SELECT') END
            ),
            'authenticated_select_buyers', (
                CASE WHEN to_regclass('public.guest_shop_buyers') IS NULL THEN NULL
                     ELSE has_table_privilege('authenticated', 'public.guest_shop_buyers', 'SELECT') END
            ),
            'anon_select_attempts', (
                CASE WHEN to_regclass('public.guest_shop_access_attempts') IS NULL THEN NULL
                     ELSE has_table_privilege('anon', 'public.guest_shop_access_attempts', 'SELECT') END
            ),
            'authenticated_select_attempts', (
                CASE WHEN to_regclass('public.guest_shop_access_attempts') IS NULL THEN NULL
                     ELSE has_table_privilege('authenticated', 'public.guest_shop_access_attempts', 'SELECT') END
            ),
            'service_role_select_buyers', (
                CASE WHEN to_regclass('public.guest_shop_buyers') IS NULL THEN NULL
                     ELSE has_table_privilege('service_role', 'public.guest_shop_buyers', 'SELECT') END
            ),
            'service_role_insert_buyers', (
                CASE WHEN to_regclass('public.guest_shop_buyers') IS NULL THEN NULL
                     ELSE has_table_privilege('service_role', 'public.guest_shop_buyers', 'INSERT') END
            ),
            'browser_policies', (
                SELECT COALESCE(jsonb_agg(policyname ORDER BY policyname), '[]'::jsonb)
                FROM pg_policies
                WHERE schemaname = 'public'
                  AND tablename IN ('guest_shop_buyers', 'guest_shop_access_attempts')
            ),
            'realtime_published', EXISTS (
                SELECT 1 FROM pg_publication_tables
                WHERE pubname = 'supabase_realtime'
                  AND schemaname = 'public'
                  AND tablename IN ('guest_shop_buyers', 'guest_shop_access_attempts')
            )
        ),
        jsonb_build_object(
            'buyers_rls_enabled', true,
            'attempts_rls_enabled', true,
            'anon_select_buyers', false,
            'authenticated_select_buyers', false,
            'anon_select_attempts', false,
            'authenticated_select_attempts', false,
            'service_role_select_buyers', true,
            'service_role_insert_buyers', true,
            'browser_policies', '[]'::jsonb,
            'realtime_published', false
        )
    UNION ALL
    SELECT
        7,
        'orders_buyer_id_link',
        jsonb_build_object(
            'column_present', EXISTS (
                SELECT 1 FROM pg_attribute a
                WHERE a.attrelid = to_regclass('public.guest_shop_orders')
                  AND a.attname = 'buyer_id'
                  AND a.attnum > 0
                  AND NOT a.attisdropped
                  AND format_type(a.atttypid, a.atttypmod) = 'uuid'
            ),
            'column_nullable_for_history', EXISTS (
                SELECT 1 FROM pg_attribute a
                WHERE a.attrelid = to_regclass('public.guest_shop_orders')
                  AND a.attname = 'buyer_id'
                  AND NOT a.attnotnull
            ),
            'foreign_key_to_buyers', EXISTS (SELECT 1 FROM orders_constraints),
            'foreign_key_on_delete_set_null', (
                SELECT COALESCE(bool_and(def ~ 'ON DELETE SET NULL'), false) FROM orders_constraints
            ),
            'index_present', EXISTS (
                SELECT 1 FROM pg_indexes
                WHERE schemaname = 'public'
                  AND tablename = 'guest_shop_orders'
                  AND indexname = 'guest_shop_orders_buyer_idx'
            )
        ),
        jsonb_build_object(
            'column_present', true,
            'column_nullable_for_history', true,
            'foreign_key_to_buyers', true,
            'foreign_key_on_delete_set_null', true,
            'index_present', true
        )
    UNION ALL
    -- The 20260915 12-parameter overload MUST be gone: leaving both would make
    -- every named-parameter RPC call from server/api-handlers/public/guest-shop.js
    -- ambiguous and take guest checkout down.
    SELECT
        8,
        'create_order_signature_migrated',
        jsonb_build_object(
            'new_13_param_signature_present', (
                to_regprocedure('public.fn_guest_shop_create_order(text, uuid, uuid, text, text, text, text, text, text, uuid, text, text, integer)') IS NOT NULL
            ),
            'legacy_12_param_signature_absent', (
                to_regprocedure('public.fn_guest_shop_create_order(text, uuid, uuid, text, text, text, text, text, text, text, text, integer)') IS NULL
            ),
            'single_overload', (
                (SELECT count(*) FROM pg_proc WHERE proname = 'fn_guest_shop_create_order' AND pronamespace = 'public'::regnamespace) = 1
            ),
            'arity', (SELECT arity FROM fn),
            'has_p_buyer_id_param', (SELECT COALESCE(bool_and('p_buyer_id' = ANY(proargnames)), false) FROM fn),
            'security_definer', (SELECT COALESCE(bool_and(security_definer), false) FROM fn),
            'search_path_pinned', (
                SELECT COALESCE(bool_and(EXISTS (
                    SELECT 1 FROM unnest(proconfig) cfg WHERE cfg = 'search_path=public, pg_temp'
                )), false)
                FROM fn
            )
        ),
        jsonb_build_object(
            'new_13_param_signature_present', true,
            'legacy_12_param_signature_absent', true,
            'single_overload', true,
            'arity', 13,
            'has_p_buyer_id_param', true,
            'security_definer', true,
            'search_path_pinned', true
        )
    UNION ALL
    SELECT
        9,
        'create_order_buyer_binding_guards',
        jsonb_build_object(
            'requires_contact_hash_with_buyer_id', (SELECT COALESCE(bool_and(def ~ 'guest_buyer_contact_required'), false) FROM fn),
            'rejects_buyer_contact_mismatch', (SELECT COALESCE(bool_and(def ~ 'guest_buyer_mismatch'), false) FROM fn),
            'binding_checks_same_site', (SELECT COALESCE(bool_and(def ~ 'b\.site = v_site'), false) FROM fn),
            'binding_checks_same_contact_hash', (SELECT COALESCE(bool_and(def ~ 'b\.contact_hash = p_buyer_contact_hash'), false) FROM fn),
            'insert_persists_buyer_id', (SELECT COALESCE(bool_and(def ~ 'buyer_contact_hash, buyer_id, request_ip_hash'), false) FROM fn),
            'keeps_service_role_gate', (SELECT COALESCE(bool_and(def ~ 'guest_shop_require_service_role'), false) FROM fn),
            'keeps_credit_price_resolver', (SELECT COALESCE(bool_and(def ~ 'guest_shop_resolve_credit_unit_amount'), false) FROM fn),
            'keeps_existing_guards', (
                SELECT COALESCE(bool_and(
                    def ~ 'guest_invalid_site'
                    AND def ~ 'guest_invalid_payment_provider'
                    AND def ~ 'guest_idempotency_conflict'
                    AND def ~ 'guest_purchase_disabled'
                    AND def ~ 'guest_inventory_unavailable'
                ), false)
                FROM fn
            ),
            'quantity_still_hardcoded_to_one', (SELECT COALESCE(bool_and(def !~ 'p_quantity'), false) FROM fn)
        ),
        jsonb_build_object(
            'requires_contact_hash_with_buyer_id', true,
            'rejects_buyer_contact_mismatch', true,
            'binding_checks_same_site', true,
            'binding_checks_same_contact_hash', true,
            'insert_persists_buyer_id', true,
            'keeps_service_role_gate', true,
            'keeps_credit_price_resolver', true,
            'keeps_existing_guards', true,
            'quantity_still_hardcoded_to_one', true
        )
    UNION ALL
    SELECT
        10,
        'create_order_grants',
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
    -- A0 must be behaviour-neutral. The assertions here are STRUCTURAL, not
    -- row counts: a row-count check ("no order has a buyer_id yet") would only
    -- be true in the instant after the migration and would start reporting a
    -- false FAIL as soon as A1 goes live. Operators re-run verify scripts.
    SELECT
        11,
        'a0_is_behaviour_neutral',
        jsonb_build_object(
            'no_backfill_trigger_on_orders', NOT EXISTS (
                SELECT 1 FROM pg_trigger t
                WHERE t.tgrelid = to_regclass('public.guest_shop_orders')
                  AND NOT t.tgisinternal
                  AND t.tgname ~* 'buyer'
            ),
            'orders_rls_still_enabled', (
                SELECT COALESCE(bool_and(relrowsecurity), false)
                FROM pg_class WHERE oid = to_regclass('public.guest_shop_orders')
            ),
            'buyer_id_has_no_not_null', EXISTS (
                SELECT 1 FROM pg_attribute a
                WHERE a.attrelid = to_regclass('public.guest_shop_orders')
                  AND a.attname = 'buyer_id'
                  AND NOT a.attnotnull
            ),
            'no_purge_job_created_by_migration', NOT EXISTS (
                SELECT 1 FROM pg_proc p
                WHERE p.pronamespace = 'public'::regnamespace
                  AND p.proname ~* 'guest_shop.*purge|purge.*guest_shop_access'
            )
        ),
        jsonb_build_object(
            'no_backfill_trigger_on_orders', true,
            'orders_rls_still_enabled', true,
            'buyer_id_has_no_not_null', true,
            'no_purge_job_created_by_migration', true
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
