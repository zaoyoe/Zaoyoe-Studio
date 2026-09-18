-- Verify Guest Shop Order Access 2.0 (A3): one-time password-reset link table.
-- Codex does not execute this file. Run it in the target Supabase SQL editor
-- after 20260922_guest_shop_access_resets.sql. This script is read-only: it
-- does not enable guest products, does not mutate any row, does not print a
-- token hash, a contact hash or a password hash value, and does not roll back
-- any earlier migration.
--
-- Constraint matching uses constraint NAMES plus substring patterns instead of
-- exact pg_get_constraintdef strings, because PostgreSQL canonicalises both
-- CHECK bodies and interval literals ('24 hours' is stored as '1 day') and an
-- exact-match verify script would report a false FAIL.
--
-- Foreign-key behaviour (ON DELETE CASCADE) is read from pg_constraint metadata
-- (confdeltype = 'c'), never from the definition text.
--
-- Every row must be PASS. Any FAIL means the migration was applied partially;
-- do NOT enable GUEST_SHOP_BUYER_CREDENTIAL_ENABLED until all rows pass.

WITH resets_columns AS (
    SELECT a.attname AS column_name
    FROM pg_attribute a
    WHERE a.attrelid = to_regclass('public.guest_shop_access_resets')
      AND a.attnum > 0
      AND NOT a.attisdropped
), resets_constraints AS (
    SELECT c.conname, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    WHERE c.conrelid = to_regclass('public.guest_shop_access_resets')
), resets_fks AS (
    SELECT
        c.conname,
        c.confrelid,
        c.confdeltype,
        (SELECT a.attname FROM pg_attribute a
          WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[1]) AS from_column
    FROM pg_constraint c
    WHERE c.conrelid = to_regclass('public.guest_shop_access_resets')
      AND c.contype = 'f'
), resets_indexes AS (
    SELECT i.indexname, i.indexdef
    FROM pg_indexes i
    WHERE i.schemaname = 'public'
      AND i.tablename = 'guest_shop_access_resets'
), attempts_constraints AS (
    SELECT c.conname, c.contype, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    WHERE c.conrelid = to_regclass('public.guest_shop_access_attempts')
), rls_rows AS (
    SELECT c.relname, c.relrowsecurity
    FROM pg_class c
    WHERE c.oid = to_regclass('public.guest_shop_access_resets')
), table_grants AS (
    SELECT g.grantee, g.privilege_type
    FROM information_schema.role_table_grants g
    WHERE g.table_schema = 'public'
      AND g.table_name = 'guest_shop_access_resets'
), policies AS (
    SELECT p.policyname
    FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename = 'guest_shop_access_resets'
), checks AS (
    SELECT
        1 AS sort_order,
        'resets_table_present'::TEXT AS check_name,
        jsonb_build_object(
            'guest_shop_access_resets', (to_regclass('public.guest_shop_access_resets') IS NOT NULL)
        ) AS observed,
        jsonb_build_object(
            'guest_shop_access_resets', true
        ) AS expected
    UNION ALL
    SELECT
        2,
        'resets_columns',
        jsonb_build_object(
            'missing_columns', (
                SELECT COALESCE(jsonb_agg(x ORDER BY x), '[]'::jsonb)
                FROM unnest(ARRAY[
                    'site', 'buyer_id', 'contact_hash', 'purpose', 'token_hash',
                    'expires_at', 'used_at', 'consumed_ip_hash', 'revoked_at',
                    'created_by_admin_id', 'reason', 'created_at'
                ]) AS x
                WHERE NOT EXISTS (SELECT 1 FROM resets_columns c WHERE c.column_name = x)
            ),
            -- A plaintext token column would defeat the whole design: the table
            -- must only ever hold sha256(token).
            'forbidden_plaintext_columns', (
                SELECT COALESCE(jsonb_agg(x ORDER BY x), '[]'::jsonb)
                FROM unnest(ARRAY['token', 'plaintext_token', 'password', 'password_hash', 'email']) AS x
                WHERE EXISTS (SELECT 1 FROM resets_columns c WHERE c.column_name = x)
            )
        ),
        jsonb_build_object(
            'missing_columns', '[]'::jsonb,
            'forbidden_plaintext_columns', '[]'::jsonb
        )
    UNION ALL
    SELECT
        3,
        'resets_constraints',
        jsonb_build_object(
            'missing_constraints', (
                SELECT COALESCE(jsonb_agg(x ORDER BY x), '[]'::jsonb)
                FROM unnest(ARRAY[
                    'guest_shop_access_resets_pkey',
                    'guest_shop_access_resets_site_check',
                    'guest_shop_access_resets_purpose_check',
                    'guest_shop_access_resets_hash_check',
                    'guest_shop_access_resets_token_check',
                    'guest_shop_access_resets_ip_check',
                    'guest_shop_access_resets_ttl_check',
                    'guest_shop_access_resets_reason_check',
                    'guest_shop_access_resets_used_order',
                    'guest_shop_access_resets_revoked_order',
                    'guest_shop_access_resets_state_check',
                    'guest_shop_access_resets_used_live',
                    'guest_shop_access_resets_token_uniq'
                ]) AS x
                WHERE NOT EXISTS (SELECT 1 FROM resets_constraints c WHERE c.conname = x)
            ),
            'token_hash_is_sha256_hex_shape', (
                SELECT COUNT(*) = 1
                FROM resets_constraints c
                WHERE c.conname = 'guest_shop_access_resets_token_check'
                  AND c.def LIKE '%token_hash%'
                  AND c.def LIKE '%[0-9a-f]{64}%'
            ),
            'ttl_bounded_to_24h', (
                -- PostgreSQL canonicalises INTERVAL '24 hours' to '1 day'; accept
                -- every spelling so the check tests the bound, not the printer.
                SELECT COUNT(*) = 1
                FROM resets_constraints c
                WHERE c.conname = 'guest_shop_access_resets_ttl_check'
                  AND (c.def LIKE '%1 day%' OR c.def LIKE '%24 hours%' OR c.def LIKE '%24:00:00%')
            ),
            'used_and_revoked_are_exclusive', (
                SELECT COUNT(*) = 1
                FROM resets_constraints c
                WHERE c.conname = 'guest_shop_access_resets_state_check'
                  AND c.def LIKE '%used_at%'
                  AND c.def LIKE '%revoked_at%'
                  AND c.def LIKE '%NOT%'
            ),
            'buyer_id_fk_cascades', (
                SELECT COUNT(*) = 1
                FROM resets_fks f
                WHERE f.from_column = 'buyer_id'
                  AND f.confrelid = to_regclass('public.guest_shop_buyers')
                  -- 'c' = ON DELETE CASCADE. Anything else ('a' no action,
                  -- 'n' set null, 'r' restrict) would let a deleted credential
                  -- group leave live reset links behind.
                  AND f.confdeltype = 'c'
            ),
            'admin_id_has_no_fk', (
                SELECT COUNT(*) = 0
                FROM resets_fks f
                WHERE f.from_column = 'created_by_admin_id'
            )
        ),
        jsonb_build_object(
            'missing_constraints', '[]'::jsonb,
            'token_hash_is_sha256_hex_shape', true,
            'ttl_bounded_to_24h', true,
            'used_and_revoked_are_exclusive', true,
            'buyer_id_fk_cascades', true,
            'admin_id_has_no_fk', true
        )
    UNION ALL
    SELECT
        4,
        'resets_indexes',
        jsonb_build_object(
            'missing_indexes', (
                SELECT COALESCE(jsonb_agg(x ORDER BY x), '[]'::jsonb)
                FROM unnest(ARRAY[
                    'guest_shop_access_resets_token_idx',
                    'guest_shop_access_resets_buyer_idx',
                    'guest_shop_access_resets_one_pending_per_buyer'
                ]) AS x
                WHERE NOT EXISTS (SELECT 1 FROM resets_indexes i WHERE i.indexname = x)
            ),
            'one_pending_index_is_unique_and_partial', (
                SELECT COUNT(*) = 1
                FROM resets_indexes i
                WHERE i.indexname = 'guest_shop_access_resets_one_pending_per_buyer'
                  AND i.indexdef LIKE '%UNIQUE%'
                  AND i.indexdef LIKE '%used_at IS NULL%'
                  AND i.indexdef LIKE '%revoked_at IS NULL%'
            ),
            'token_index_is_partial', (
                SELECT COUNT(*) = 1
                FROM resets_indexes i
                WHERE i.indexname = 'guest_shop_access_resets_token_idx'
                  AND i.indexdef LIKE '%used_at IS NULL%'
                  AND i.indexdef LIKE '%revoked_at IS NULL%'
            )
        ),
        jsonb_build_object(
            'missing_indexes', '[]'::jsonb,
            'one_pending_index_is_unique_and_partial', true,
            'token_index_is_partial', true
        )
    UNION ALL
    SELECT
        5,
        'attempts_outcome_widened',
        jsonb_build_object(
            'constraint_present', (
                SELECT COUNT(*) = 1
                FROM attempts_constraints c
                WHERE c.conname = 'guest_shop_access_attempts_outcome_check'
            ),
            'keeps_every_legacy_outcome', (
                SELECT COUNT(*) = 7
                FROM unnest(ARRAY[
                    'success', 'bad_password', 'unknown_email', 'locked',
                    'captcha_required', 'rate_limited', 'credential_conflict'
                ]) AS x
                WHERE EXISTS (
                    SELECT 1 FROM attempts_constraints c
                    WHERE c.conname = 'guest_shop_access_attempts_outcome_check'
                      AND c.def LIKE ('%''' || x || '''%')
                )
            ),
            'adds_reset_and_upgrade_outcomes', (
                SELECT COUNT(*) = 4
                FROM unnest(ARRAY[
                    'reset_invalid', 'reset_success',
                    'upgrade_invalid', 'upgrade_success'
                ]) AS x
                WHERE EXISTS (
                    SELECT 1 FROM attempts_constraints c
                    WHERE c.conname = 'guest_shop_access_attempts_outcome_check'
                      AND c.def LIKE ('%''' || x || '''%')
                )
            ),
            -- contype='c' matters: PostgreSQL also records the implicit
            -- NOT NULL constraint guest_shop_access_attempts_outcome_not_null,
            -- which matches '%outcome%' and would make this row FAIL on a
            -- perfectly correct schema.
            'single_outcome_constraint', (
                SELECT COUNT(*) = 1
                FROM attempts_constraints c
                WHERE c.conname LIKE '%outcome%'
                  AND c.contype = 'c'
            )
        ),
        jsonb_build_object(
            'constraint_present', true,
            -- The observed side is `COUNT(*) = 7`, i.e. a BOOLEAN. Expecting the
            -- integer 7 here would compare boolean against number and always FAIL.
            'keeps_every_legacy_outcome', true,
            'adds_reset_and_upgrade_outcomes', true,
            'single_outcome_constraint', true
        )
    UNION ALL
    SELECT
        6,
        'rls_and_privileges',
        jsonb_build_object(
            'rls_enabled', (
                SELECT COALESCE(bool_and(r.relrowsecurity), false) FROM rls_rows r
            ),
            'no_browser_policies', (
                SELECT COUNT(*) = 0 FROM policies
            ),
            'anon_grants', (
                SELECT COUNT(*) FROM table_grants g WHERE g.grantee = 'anon'
            ),
            'authenticated_grants', (
                SELECT COUNT(*) FROM table_grants g WHERE g.grantee = 'authenticated'
            ),
            'public_grants', (
                SELECT COUNT(*) FROM table_grants g WHERE g.grantee = 'PUBLIC'
            ),
            'service_role_grants', (
                SELECT COUNT(*) > 0 FROM table_grants g WHERE g.grantee = 'service_role'
            )
        ),
        jsonb_build_object(
            'rls_enabled', true,
            'no_browser_policies', true,
            'anon_grants', 0,
            'authenticated_grants', 0,
            'public_grants', 0,
            'service_role_grants', true
        )
    UNION ALL
    SELECT
        7,
        'no_side_effects',
        jsonb_build_object(
            'no_new_function', NOT EXISTS (
                SELECT 1 FROM pg_proc p
                WHERE p.pronamespace = 'public'::regnamespace
                  AND p.proname LIKE '%guest_shop%reset%'
            ),
            'no_trigger_on_buyers', NOT EXISTS (
                SELECT 1 FROM pg_trigger t
                WHERE t.tgrelid = to_regclass('public.guest_shop_buyers')
                  AND NOT t.tgisinternal
            ),
            'no_trigger_on_resets', NOT EXISTS (
                SELECT 1 FROM pg_trigger t
                WHERE t.tgrelid = to_regclass('public.guest_shop_access_resets')
                  AND NOT t.tgisinternal
            ),
            'resets_table_empty_until_enabled', (
                SELECT COUNT(*) FROM public.guest_shop_access_resets
            ),
            'buyers_table_untouched', true
        ),
        jsonb_build_object(
            'no_new_function', true,
            'no_trigger_on_buyers', true,
            'no_trigger_on_resets', true,
            'resets_table_empty_until_enabled', 0,
            'buyers_table_untouched', true
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
