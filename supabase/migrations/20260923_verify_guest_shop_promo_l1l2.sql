-- Verify Guest Shop Promo L1+L2: guest quantity/tiered pricing (L1) and guest
-- discount codes (L2) settled in cash at credit parity.
-- Codex does not execute this file. Run it in the target Supabase SQL editor
-- after 20260923_guest_shop_promo_l1l2.sql. This script is read-only: it does
-- not enable guest products, does not raise GUEST_SHOP_MAX_QUANTITY, does not
-- turn on GUEST_SHOP_DISCOUNT_ENABLED, does not mutate any row, does not print
-- a contact hash, a claim-secret hash, a card content value or a password hash,
-- and does not roll back any earlier migration.
--
-- WHY SUBSTRING MATCHING INSTEAD OF pg_get_constraintdef EQUALITY
--   PostgreSQL canonicalises CHECK bodies and numeric literals, so an
--   exact-match verify script reports false FAILs across versions. Constraints
--   are therefore matched by NAME plus a set of required substring clauses:
--   every clause below is a distinct money or stock invariant, and a migration
--   that lost one of them must fail here.
--
-- WHY THE FUNCTION-ARITY CHECK IS AN ORDERED ARRAY
--   fn_guest_shop_create_order was DROPped and re-CREATEd at 15 parameters. If
--   a stale 13-parameter overload survived, PostgREST would fail every guest
--   RPC with "could not choose the best candidate function". A jsonb OBJECT
--   would silently collapse the duplicate key; a jsonb ARRAY of "name/arity"
--   strings shows the duplicate as a second element and fails.
--
-- RULE FOR PROBE AUTHORS (four false-FAIL classes, all hit by this repository's
-- own verify scripts; every one of them was a PROBE defect, never a migration
-- defect, and every one of them cost an operator's trust in the whole output)
--   1. A probe that matches regex SOURCE with a regex can never hit
--      (20260920_verify, pwd_format). Use strpos()/LIKE for literal text.
--   2. A probe pinned to one signature era reports FAIL against a correct
--      database the moment a later migration changes the arity
--      (20260920/21_verify, create_order 13 -> 15). Derive the expectation from
--      a registered era list instead of a constant.
--   3. pg_proc.prosrc KEEPS the function's own SQL comments, so a DML keyword
--      scan over raw prosrc matches COMMENT TEXT. fn_guest_shop_evaluate_discount
--      documents its atomicity rationale with the sentence "deduction is the
--      atomic UPDATE pair in fn_guest_shop_reserve_discount", and the retired
--      prosrc ~* UPDATE probe turned that comment into a false
--      evaluate_is_read_only FAIL on a genuinely read-only function. Strip
--      comments first (CTE fn_code) and keep a fail-closed key proving the strip
--      did not eat the body. NEVER "fix" this by deleting the rationale comment
--      or by dropping the read-only assertion.
--      EVERY function-body scan in this file therefore runs against fn_code,
--      positive probes included: a positive probe satisfied only by a comment is
--      a false PASS, which is the more dangerous direction of the same defect.
--      When this upgrade was made, every POSITIVE body probe returned identical
--      results against raw prosrc and against fn_code (replayed statically over
--      every guest_shop body in the repository), so the upgrade is
--      behaviour-preserving for those and strictly stronger from now on. The one
--      deliberate exception is the NEGATIVE read-only DML probe this rule exists
--      to fix: it moves FAIL -> PASS on a genuinely read-only function whose own
--      comment merely mentioned UPDATE. No body probe may ever move in the
--      PASS -> FAIL direction when the comment strip is added or changed.
--   4. Do not pin OPERATOR STATE to a constant. Row 16's retired
--      guest_products_enabled = 0 expectation FAILed because an operator had
--      opened products to guest checkout, which is a human decision no migration
--      can make. Assert the MECHANISM in the PASS/FAIL rows (no guest_shop
--      function may write shop_products) and print the live state in a REVIEW row
--      (23) instead.
--
-- Every row must be PASS, except row 23 which is PASS or REVIEW by design.
-- Any FAIL means the migration was applied partially. A REVIEW on row 23 means
-- "a human must confirm the listed operator state", never "the migration broke".
-- Do NOT raise GUEST_SHOP_MAX_QUANTITY above 1 and do NOT enable
-- GUEST_SHOP_DISCOUNT_ENABLED until every row is PASS and row 23 is confirmed.

WITH orders_columns AS (
    SELECT a.attname AS column_name,
           format_type(a.atttypid, a.atttypmod) AS type_name,
           a.attnotnull AS not_null,
           pg_get_expr(d.adbin, d.adrelid) AS default_expr
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = to_regclass('public.guest_shop_orders')
      AND a.attnum > 0
      AND NOT a.attisdropped
), orders_constraints AS (
    SELECT c.conname,
           pg_get_constraintdef(c.oid) AS def,
           -- Canonicalise before matching: PostgreSQL rewrites numeric literals
           -- as (0)::numeric and injects implicit casts such as
           -- (quantity)::numeric, and the exact rendering has shifted between
           -- server versions. Stripping whitespace and the ::numeric cast text
           -- leaves a shape that is stable from PG13 to PG18, so a real lost
           -- clause fails here while a cosmetic rendering difference does not.
           regexp_replace(replace(pg_get_constraintdef(c.oid), '::numeric', ''), '\s+', '', 'g') AS norm
    FROM pg_constraint c
    WHERE c.conrelid = to_regclass('public.guest_shop_orders')
), reservations_constraints AS (
    SELECT c.conname, c.contype, c.conkey, pg_get_constraintdef(c.oid) AS def,
           (SELECT a.attname FROM pg_attribute a
             WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[1]) AS first_column
    FROM pg_constraint c
    WHERE c.conrelid = to_regclass('public.guest_shop_inventory_reservations')
), reservations_indexes AS (
    SELECT i.indexname, i.indexdef
    FROM pg_indexes i
    WHERE i.schemaname = 'public'
      AND i.tablename = 'guest_shop_inventory_reservations'
), ledger_columns AS (
    SELECT a.attname AS column_name,
           format_type(a.atttypid, a.atttypmod) AS type_name
    FROM pg_attribute a
    WHERE a.attrelid = to_regclass('public.guest_shop_discount_redemptions')
      AND a.attnum > 0
      AND NOT a.attisdropped
), ledger_constraints AS (
    SELECT c.conname,
           pg_get_constraintdef(c.oid) AS def,
           regexp_replace(replace(pg_get_constraintdef(c.oid), '::numeric', ''), '\s+', '', 'g') AS norm
    FROM pg_constraint c
    WHERE c.conrelid = to_regclass('public.guest_shop_discount_redemptions')
), ledger_indexes AS (
    SELECT i.indexname, i.indexdef
    FROM pg_indexes i
    WHERE i.schemaname = 'public'
      AND i.tablename = 'guest_shop_discount_redemptions'
), ledger_policies AS (
    SELECT p.policyname
    FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename = 'guest_shop_discount_redemptions'
), ledger_grants AS (
    SELECT g.grantee, g.privilege_type
    FROM information_schema.role_table_grants g
    WHERE g.table_schema = 'public'
      AND g.table_name = 'guest_shop_discount_redemptions'
), guest_fns AS (
    SELECT p.oid, p.proname, p.pronargs, p.pronargdefaults, p.proretset,
           p.prosecdef, p.proconfig, p.prosrc, p.proacl, p.proargmodes,
           p.proname || '/' || p.pronargs::TEXT AS fn_key
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname LIKE '%guest_shop%'
), fn_code AS (
    -- prosrc with the function's OWN SQL comments removed. Every DML / dynamic
    -- SQL keyword scan below MUST run against this, never against raw prosrc
    -- (header rule 3).
    --
    -- Line comments are stripped first with the 'n' (newline-sensitive) flag so
    -- the dot stops at the end of the line; block comments are stripped second
    -- with 's' so a block may span lines. That order is deliberate: a line
    -- comment containing a stray "/*" is removed before it can swallow code up
    -- to some far-away "*/". Both patterns are written backslash-free
    -- ('--.*' and '/[*].*?[*]/') so the probe is immune to the value of
    -- standard_conforming_strings.
    --
    -- Stripping comments can only be unsafe if a string literal contains a
    -- comment marker, which would let the strip eat executable code and turn a
    -- real write into a false PASS. A quote-aware scan of all 53 guest_shop
    -- function bodies in this repository finds ZERO such literals, and
    -- tests/guest-shop-verify-probe-contract.test.js asserts that stays true.
    -- Literals are therefore never stripped -- which is required, because
    -- stripping them would hide dynamic SQL such as EXECUTE 'UPDATE ...'.
    SELECT f.*,
           regexp_replace(
               regexp_replace(f.prosrc, '--.*', ' ', 'gn'),
               '/[*].*?[*]/', ' ', 'gs'
           ) AS code
    FROM guest_fns f
), fn_acls AS (
    -- A NULL proacl is NOT "no grants": PostgreSQL functions default to
    -- EXECUTE for PUBLIC. Model that explicitly, otherwise a function whose
    -- REVOKE was skipped would look clean here and be callable from a browser.
    -- aclexplode().grantee is a role OID; casting it straight to TEXT yields
    -- the number (e.g. '90196'), not the role name, so every name comparison
    -- below would silently miss. Resolve it through pg_roles, and map OID 0
    -- (the ACL spelling of PUBLIC) explicitly.
    SELECT f.fn_key,
           CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END::TEXT AS grantee,
           a.privilege_type
    FROM fn_code f
    CROSS JOIN LATERAL aclexplode(f.proacl) AS a
    LEFT JOIN pg_roles r ON r.oid = a.grantee
    UNION ALL
    SELECT f.fn_key, 'PUBLIC'::TEXT, 'EXECUTE'::TEXT
    FROM fn_code f
    WHERE f.proacl IS NULL
), checks AS (
    SELECT
        1 AS sort_order,
        'orders_new_columns'::TEXT AS check_name,
        jsonb_build_object(
            'missing_columns', (
                SELECT COALESCE(jsonb_agg(x ORDER BY x), '[]'::jsonb)
                FROM unnest(ARRAY[
                    'list_unit_amount', 'discount_amount', 'discount_code',
                    'discount_snapshot', 'payment_fee_amount'
                ]) AS x
                WHERE NOT EXISTS (SELECT 1 FROM orders_columns c WHERE c.column_name = x)
            ),
            'wrong_types', (
                SELECT COALESCE(jsonb_agg(column_name || '=' || type_name ORDER BY column_name), '[]'::jsonb)
                FROM (
                    SELECT column_name, type_name FROM orders_columns
                    WHERE (column_name = 'list_unit_amount'  AND type_name <> 'numeric(14,2)')
                       OR (column_name = 'discount_amount'   AND type_name <> 'numeric(14,2)')
                       OR (column_name = 'discount_code'     AND type_name <> 'character varying(64)')
                       OR (column_name = 'discount_snapshot' AND type_name <> 'jsonb')
                       OR (column_name = 'payment_fee_amount' AND type_name <> 'numeric(14,2)')
                ) w
            ),
            'missing_not_null_defaults', (
                SELECT COALESCE(jsonb_agg(x ORDER BY x), '[]'::jsonb)
                FROM unnest(ARRAY['discount_amount', 'payment_fee_amount']) AS x
                WHERE NOT EXISTS (
                    SELECT 1 FROM orders_columns c
                    WHERE c.column_name = x
                      AND c.not_null
                      AND COALESCE(c.default_expr, '') IN ('0', '0.00', '0::numeric', '0.00::numeric')
                )
            ),
            -- No plaintext identity, secret or card value may ever land on the
            -- order row. Only digests and the normalised code are allowed.
            'forbidden_plaintext_columns', (
                SELECT COALESCE(jsonb_agg(x ORDER BY x), '[]'::jsonb)
                FROM unnest(ARRAY[
                    'email', 'buyer_email', 'guest_email', 'password',
                    'query_password', 'password_hash', 'claim_secret',
                    'content', 'card_content'
                ]) AS x
                WHERE EXISTS (SELECT 1 FROM orders_columns c WHERE c.column_name = x)
            )
        ) AS observed,
        jsonb_build_object(
            'missing_columns', '[]'::jsonb,
            'wrong_types', '[]'::jsonb,
            'missing_not_null_defaults', '[]'::jsonb,
            'forbidden_plaintext_columns', '[]'::jsonb
        ) AS expected
    UNION ALL
    SELECT
        2,
        'orders_amount_check',
        jsonb_build_object(
            'constraint_present', EXISTS (
                SELECT 1 FROM orders_constraints
                WHERE conname = 'guest_shop_orders_amount_check'
            ),
            -- Every clause is a separate invariant. Losing any one of them is a
            -- money bug, so each is asserted by name rather than by a single
            -- canonicalised-definition comparison.
            'missing_clauses', (
                SELECT COALESCE(jsonb_agg(x ORDER BY x), '[]'::jsonb)
                FROM unnest(ARRAY[
                    'unit_amount>(0)',
                    'total_amount>(0)',
                    'payment_fee_amount>=(0)',
                    'discount_amount>=(0)',
                    'discount_amount<round((list_unit_amount*(quantity)),2)',
                    'discount_amount<=round(((list_unit_amount*(quantity))*0.5),2)',
                    'payment_fee_amount<=(round(((unit_amount*(quantity))*0.1),2)+0.01)',
                    'total_amount=((unit_amount*(quantity))+payment_fee_amount)'
                ]) AS x
                WHERE NOT EXISTS (
                    SELECT 1 FROM orders_constraints c
                    WHERE c.conname = 'guest_shop_orders_amount_check'
                      AND position(x in c.norm) > 0
                )
            ),
            -- The anti-zero-purchase pair: the total must be strictly positive
            -- AND the discount must be strictly smaller than the list amount.
            'zero_purchase_blocked', EXISTS (
                SELECT 1 FROM orders_constraints
                WHERE conname = 'guest_shop_orders_amount_check'
                  AND position('total_amount>(0)' in norm) > 0
                  AND position('discount_amount<round((list_unit_amount*(quantity)),2)' in norm) > 0
            ),
            -- The 50% floor. It is the only percent bound in this batch: no env
            -- knob exists to widen it, and the per-code / per-site budgets can
            -- only push the discount further down.
            'floor_is_half_of_list', EXISTS (
                SELECT 1 FROM orders_constraints
                WHERE conname = 'guest_shop_orders_amount_check'
                  AND position('*0.5' in norm) > 0
            ),
            -- The fee cap. Without it a mis-set provider fee could inflate the
            -- payable amount past anything the buyer was quoted.
            'fee_is_capped_at_ten_percent', EXISTS (
                SELECT 1 FROM orders_constraints
                WHERE conname = 'guest_shop_orders_amount_check'
                  AND position('*0.1' in norm) > 0
            )
        ),
        jsonb_build_object(
            'constraint_present', true,
            'missing_clauses', '[]'::jsonb,
            'zero_purchase_blocked', true,
            'floor_is_half_of_list', true,
            'fee_is_capped_at_ten_percent', true
        )
    UNION ALL
    SELECT
        3,
        'orders_quantity_and_code_checks',
        jsonb_build_object(
            'quantity_check_present', EXISTS (
                SELECT 1 FROM orders_constraints
                WHERE conname = 'guest_shop_orders_quantity_check'
            ),
            'quantity_bounds', (
                SELECT COALESCE(min(norm), '(missing)') FROM orders_constraints
                WHERE conname = 'guest_shop_orders_quantity_check'
            ),
            'code_check_present', EXISTS (
                SELECT 1 FROM orders_constraints
                WHERE conname = 'guest_shop_orders_discount_code_check'
            ),
            'code_charset_enforced', EXISTS (
                SELECT 1 FROM orders_constraints
                WHERE conname = 'guest_shop_orders_discount_code_check'
                  AND position('^[A-Z0-9][A-Z0-9_-]{0,49}$' in norm) > 0
                  AND position('ISNULL' in norm) > 0
            )
        ),
        jsonb_build_object(
            'quantity_check_present', true,
            'quantity_bounds', 'CHECK(((quantity>=1)AND(quantity<=5)))',
            'code_check_present', true,
            'code_charset_enforced', true
        )
    UNION ALL
    SELECT
        4,
        'reservations_multi_row',
        jsonb_build_object(
            -- P0 encoded "one card per order" as a single-column UNIQUE on
            -- order_id. L1 needs up to five rows per order, so that constraint
            -- must be GONE, otherwise a multi-unit order cannot be written at
            -- all. Located structurally (unique + first column = order_id +
            -- one key) rather than by auto-generated name.
            'single_column_order_unique_removed', NOT EXISTS (
                SELECT 1 FROM reservations_constraints
                WHERE contype = 'u'
                  AND array_length(conkey, 1) = 1
                  AND first_column = 'order_id'
            ),
            'pair_unique_present', EXISTS (
                SELECT 1 FROM reservations_constraints
                WHERE conname = 'guest_shop_inventory_reservations_order_inventory_uniq'
                  AND contype = 'u'
            ),
            -- The SAME physical card must still never appear twice on one order.
            'pair_unique_columns', (
                SELECT COALESCE(def, '(missing)') FROM reservations_constraints
                WHERE conname = 'guest_shop_inventory_reservations_order_inventory_uniq'
            ),
            -- The pre-existing partial unique index is the guard that stops two
            -- DIFFERENT orders from holding one card. Losing it while widening
            -- to N rows per order would allow double-selling stock.
            'active_reservation_unique_intact', EXISTS (
                SELECT 1 FROM reservations_indexes
                WHERE indexname = 'ux_guest_shop_inventory_active_reservation'
                  AND position('UNIQUE' in indexdef) > 0
                  AND position('inventory_id' in indexdef) > 0
                  AND position('held' in indexdef) > 0
                  AND position('consumed' in indexdef) > 0
            ),
            -- Must be the COMPOSITE index under its own name. 20260913 already
            -- owns idx_guest_shop_inventory_reservations_order on (order_id)
            -- alone, so reusing that name under IF NOT EXISTS would silently
            -- create nothing and leave claim/fulfilment without its stable
            -- (created_at, id) tie-break ordering.
            'claim_ordering_index_present', EXISTS (
                SELECT 1 FROM reservations_indexes
                WHERE indexname = 'idx_guest_shop_inventory_reservations_order_claim'
                  AND position('(order_id, created_at, id)' in indexdef) > 0
            ),
            'legacy_order_index_untouched', EXISTS (
                SELECT 1 FROM reservations_indexes
                WHERE indexname = 'idx_guest_shop_inventory_reservations_order'
            )
        ),
        jsonb_build_object(
            'single_column_order_unique_removed', true,
            'pair_unique_present', true,
            'pair_unique_columns', 'UNIQUE (order_id, inventory_id)',
            'active_reservation_unique_intact', true,
            'claim_ordering_index_present', true,
            'legacy_order_index_untouched', true
        )
    UNION ALL
    SELECT
        5,
        'ledger_table_columns',
        jsonb_build_object(
            'table_present', (to_regclass('public.guest_shop_discount_redemptions') IS NOT NULL),
            'missing_columns', (
                SELECT COALESCE(jsonb_agg(x ORDER BY x), '[]'::jsonb)
                FROM unnest(ARRAY[
                    'id', 'order_id', 'code', 'discount_code_id', 'site',
                    'product_id', 'sku_id', 'quantity', 'list_amount',
                    'discount_amount', 'net_amount', 'discount_version',
                    'buyer_contact_hash', 'buyer_id', 'request_ip_hash',
                    'request_device_hash', 'created_at'
                ]) AS x
                WHERE NOT EXISTS (SELECT 1 FROM ledger_columns c WHERE c.column_name = x)
            ),
            -- The ledger is the audit trail for money movement. It must store
            -- digests only: a plaintext email or query password here would be
            -- readable by anything that ever gains service_role.
            'forbidden_plaintext_columns', (
                SELECT COALESCE(jsonb_agg(x ORDER BY x), '[]'::jsonb)
                FROM unnest(ARRAY[
                    'email', 'buyer_email', 'guest_email', 'password',
                    'query_password', 'password_hash', 'claim_secret',
                    'content', 'card_content', 'discount_code_plaintext'
                ]) AS x
                WHERE EXISTS (SELECT 1 FROM ledger_columns c WHERE c.column_name = x)
            ),
            'identity_counted_by_contact_hash', EXISTS (
                SELECT 1 FROM ledger_columns WHERE column_name = 'buyer_contact_hash'
            )
        ),
        jsonb_build_object(
            'table_present', true,
            'missing_columns', '[]'::jsonb,
            'forbidden_plaintext_columns', '[]'::jsonb,
            'identity_counted_by_contact_hash', true
        )
    UNION ALL
    SELECT
        6,
        'ledger_constraints',
        jsonb_build_object(
            'missing_constraints', (
                SELECT COALESCE(jsonb_agg(x ORDER BY x), '[]'::jsonb)
                FROM unnest(ARRAY[
                    'guest_shop_discount_redemptions_pkey',
                    'guest_shop_discount_redemptions_site_check',
                    'guest_shop_discount_redemptions_code_check',
                    'guest_shop_discount_redemptions_hash_check',
                    'guest_shop_discount_redemptions_qty_check',
                    'guest_shop_discount_redemptions_amount_check',
                    'guest_shop_discount_redemptions_ip_check',
                    'guest_shop_discount_redemptions_order_code_uniq'
                ]) AS x
                WHERE NOT EXISTS (SELECT 1 FROM ledger_constraints c WHERE c.conname = x)
            ),
            'missing_amount_clauses', (
                SELECT COALESCE(jsonb_agg(x ORDER BY x), '[]'::jsonb)
                FROM unnest(ARRAY[
                    'list_amount>(0)',
                    'discount_amount>(0)',
                    'net_amount>(0)',
                    'discount_amount<list_amount',
                    'discount_amount<=round((list_amount*0.5),2)',
                    'net_amount=round((list_amount-discount_amount),2)'
                ]) AS x
                WHERE NOT EXISTS (
                    SELECT 1 FROM ledger_constraints c
                    WHERE c.conname = 'guest_shop_discount_redemptions_amount_check'
                      AND position(x in c.norm) > 0
                )
            ),
            'quantity_bounded_1_to_5', EXISTS (
                SELECT 1 FROM ledger_constraints
                WHERE conname = 'guest_shop_discount_redemptions_qty_check'
                  AND position('quantity>=1' in norm) > 0
                  AND position('quantity<=5' in norm) > 0
            ),
            -- A retried create must never write a second ledger row, or a limit
            -- counted from this table would be inflated and a code could be
            -- farmed by replaying one order.
            'one_redemption_per_order_per_code', EXISTS (
                SELECT 1 FROM ledger_constraints
                WHERE conname = 'guest_shop_discount_redemptions_order_code_uniq'
            ),
            'buyer_fk_sets_null', EXISTS (
                SELECT 1 FROM pg_constraint c
                WHERE c.conrelid = to_regclass('public.guest_shop_discount_redemptions')
                  AND c.contype = 'f'
                  AND c.confrelid = to_regclass('public.guest_shop_buyers')
                  AND c.confdeltype = 'n'
            ),
            -- discount_code_id must NOT be a foreign key: a deleted marketing
            -- code must never cascade away the redemption evidence.
            'discount_code_id_is_not_a_fk', NOT EXISTS (
                SELECT 1 FROM pg_constraint c
                JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
                WHERE c.conrelid = to_regclass('public.guest_shop_discount_redemptions')
                  AND c.contype = 'f'
                  AND a.attname = 'discount_code_id'
            )
        ),
        jsonb_build_object(
            'missing_constraints', '[]'::jsonb,
            'missing_amount_clauses', '[]'::jsonb,
            'quantity_bounded_1_to_5', true,
            'one_redemption_per_order_per_code', true,
            'buyer_fk_sets_null', true,
            'discount_code_id_is_not_a_fk', true
        )
    UNION ALL
    SELECT
        7,
        'ledger_indexes',
        jsonb_build_object(
            'missing_indexes', (
                SELECT COALESCE(jsonb_agg(x ORDER BY x), '[]'::jsonb)
                FROM unnest(ARRAY[
                    'idx_guest_shop_discount_redemptions_contact_24h',
                    'idx_guest_shop_discount_redemptions_ip_24h',
                    'idx_guest_shop_discount_redemptions_code'
                ]) AS x
                WHERE NOT EXISTS (SELECT 1 FROM ledger_indexes i WHERE i.indexname = x)
            ),
            -- Per-identity limits are counted by contact_hash across credential
            -- groups. Without this index the limit check becomes a seq scan on
            -- the hottest guest path, which is how a rate limit gets bypassed
            -- under load rather than by logic.
            'contact_index_leads_with_hash', EXISTS (
                SELECT 1 FROM ledger_indexes
                WHERE indexname = 'idx_guest_shop_discount_redemptions_contact_24h'
                  AND position('buyer_contact_hash' in indexdef) > 0
                  AND position('created_at DESC' in indexdef) > 0
            ),
            'ip_index_is_partial', EXISTS (
                SELECT 1 FROM ledger_indexes
                WHERE indexname = 'idx_guest_shop_discount_redemptions_ip_24h'
                  AND position('WHERE (request_ip_hash IS NOT NULL)' in indexdef) > 0
            )
        ),
        jsonb_build_object(
            'missing_indexes', '[]'::jsonb,
            'contact_index_leads_with_hash', true,
            'ip_index_is_partial', true
        )
    UNION ALL
    SELECT
        8,
        'ledger_rls_and_privileges',
        jsonb_build_object(
            'rls_enabled', COALESCE((
                SELECT c.relrowsecurity FROM pg_class c
                WHERE c.oid = to_regclass('public.guest_shop_discount_redemptions')
            ), false),
            -- Supabase's ALTER DEFAULT PRIVILEGES grants ALL on every new public
            -- table to anon and authenticated. RLS alone is not enough and
            -- REVOKE alone is not enough; both must hold.
            'anon_grants', (
                SELECT COUNT(*) FROM ledger_grants WHERE grantee = 'anon'
            ),
            'authenticated_grants', (
                SELECT COUNT(*) FROM ledger_grants WHERE grantee = 'authenticated'
            ),
            'public_grants', (
                SELECT COUNT(*) FROM ledger_grants WHERE grantee = 'PUBLIC'
            ),
            'service_role_grants', EXISTS (
                SELECT 1 FROM ledger_grants WHERE grantee = 'service_role'
            ),
            'no_browser_policies', NOT EXISTS (SELECT 1 FROM ledger_policies)
        ),
        jsonb_build_object(
            'rls_enabled', true,
            'anon_grants', 0,
            'authenticated_grants', 0,
            'public_grants', 0,
            'service_role_grants', true,
            'no_browser_policies', true
        )
    UNION ALL
    SELECT
        9,
        'function_arity_single_overload',
        jsonb_build_object(
            -- Ordered ARRAY, not object: a surviving duplicate overload shows up
            -- as a repeated element and fails the comparison.
            'guest_shop_functions', (
                SELECT COALESCE(jsonb_agg(fn_key ORDER BY fn_key), '[]'::jsonb)
                FROM fn_code
            ),
            'create_order_is_15_args', (
                SELECT COUNT(*) FROM fn_code
                WHERE proname = 'fn_guest_shop_create_order' AND pronargs = 15
            ),
            'no_stale_create_order_overload', (
                SELECT COUNT(*) FROM fn_code
                WHERE proname = 'fn_guest_shop_create_order' AND pronargs <> 15
            ),
            -- Both new parameters must keep defaults so the P0 call site (13
            -- arguments) still resolves after an application rollback.
            -- All seven trailing parameters keep defaults, so the P0 call site
            -- (13 arguments) still resolves after an application rollback and
            -- PostgREST never has to choose between overloads.
            'new_params_have_defaults', (
                SELECT COUNT(*) FROM fn_code
                WHERE proname = 'fn_guest_shop_create_order'
                  AND pronargs = 15
                  AND pronargdefaults = 7
            ),
            -- RETURNS TABLE columns are 't'-mode entries in proargmodes, not
            -- pg_attribute rows: the return type is an anonymous record.
            'create_order_returns_16_columns', (
                SELECT COUNT(*) FROM pg_proc p
                CROSS JOIN LATERAL unnest(p.proargmodes) AS m(mode)
                WHERE p.oid = (SELECT oid FROM fn_code
                                WHERE proname = 'fn_guest_shop_create_order' LIMIT 1)
                  AND m.mode = 't'
            ),
            'create_order_returns_set', (
                SELECT COALESCE(proretset, false) FROM fn_code
                WHERE proname = 'fn_guest_shop_create_order' LIMIT 1
            )
        ),
        jsonb_build_object(
            'guest_shop_functions', '[
                "fn_guest_shop_admin_manual_fulfill/4",
                "fn_guest_shop_admin_queue_refund/4",
                "fn_guest_shop_admin_unlock_dead_letter/4",
                "fn_guest_shop_claim_fulfillment/2",
                "fn_guest_shop_confirm_payment/13",
                "fn_guest_shop_consume_reservation/2",
                "fn_guest_shop_create_order/15",
                "fn_guest_shop_evaluate_discount/11",
                "fn_guest_shop_list_delivered_content/1",
                "fn_guest_shop_mark_fulfilled/2",
                "fn_guest_shop_promo_record_event/3",
                "fn_guest_shop_promo_set_breaker/3",
                "fn_guest_shop_promo_status/0",
                "fn_guest_shop_record_refund_result/5",
                "fn_guest_shop_release_expired_reservations/1",
                "fn_guest_shop_release_reservation/3",
                "fn_guest_shop_reserve_discount/13",
                "fn_guest_shop_return_discount_reservation/2",
                "fn_guest_shop_upsert_buyer_group/7",
                "guest_shop_has_active_worker_lease/2",
                "guest_shop_merge_admin_action_metadata/5",
                "guest_shop_normalize_admin_reason/1",
                "guest_shop_normalize_site/1",
                "guest_shop_payment_is_final_success/1",
                "guest_shop_promo_gate/2",
                "guest_shop_release_held_reservations/2",
                "guest_shop_require_service_role/0",
                "guest_shop_reservation_rollup/1",
                "guest_shop_resolve_credit_unit_amount/14",
                "guest_shop_validate_inventory_reservation/0",
                "guest_shop_validate_payment_event/0",
                "guest_shop_validate_payment_order/0"
            ]'::jsonb,
            'create_order_is_15_args', 1,
            'no_stale_create_order_overload', 0,
            'new_params_have_defaults', 1,
            'create_order_returns_16_columns', 16,
            'create_order_returns_set', true
        )
    UNION ALL
    SELECT
        10,
        'function_privileges',
        jsonb_build_object(
            -- Any of these granted to a browser role is a full guest-shop
            -- bypass: each function only checks auth.role() at runtime and
            -- relies on the grant layer to keep anon away from card content,
            -- buyer hashes and money columns.
            'anon_executable_functions', (
                SELECT COALESCE(jsonb_agg(DISTINCT fn_key ORDER BY fn_key), '[]'::jsonb)
                FROM fn_acls WHERE grantee = 'anon' AND privilege_type = 'EXECUTE'
            ),
            'authenticated_executable_functions', (
                SELECT COALESCE(jsonb_agg(DISTINCT fn_key ORDER BY fn_key), '[]'::jsonb)
                FROM fn_acls WHERE grantee = 'authenticated' AND privilege_type = 'EXECUTE'
            ),
            'public_executable_functions', (
                SELECT COALESCE(jsonb_agg(DISTINCT fn_key ORDER BY fn_key), '[]'::jsonb)
                FROM fn_acls WHERE grantee = 'PUBLIC' AND privilege_type = 'EXECUTE'
            ),
            'functions_missing_service_role_grant', (
                SELECT COALESCE(jsonb_agg(f.fn_key ORDER BY f.fn_key), '[]'::jsonb)
                FROM fn_code f
                WHERE NOT EXISTS (
                    SELECT 1 FROM fn_acls a
                    WHERE a.fn_key = f.fn_key
                      AND a.grantee = 'service_role'
                      AND a.privilege_type = 'EXECUTE'
                )
            )
        ),
        jsonb_build_object(
            'anon_executable_functions', '[]'::jsonb,
            'authenticated_executable_functions', '[]'::jsonb,
            'public_executable_functions', '[]'::jsonb,
            'functions_missing_service_role_grant', '[]'::jsonb
        )
    UNION ALL
    SELECT
        11,
        'function_hardening',
        jsonb_build_object(
            -- A SECURITY DEFINER function without a pinned search_path is a
            -- privilege-escalation vector: an attacker who can create objects
            -- in a schema earlier on the path shadows a referenced table.
            'definers_without_pinned_search_path', (
                SELECT COALESCE(jsonb_agg(fn_key ORDER BY fn_key), '[]'::jsonb)
                FROM fn_code
                WHERE prosecdef
                  AND NOT ('search_path=public, pg_temp' = ANY(COALESCE(proconfig, ARRAY[]::TEXT[])))
            ),
            -- Every state-changing or money-reading entry point must refuse to
            -- run for anything other than service_role, independent of grants.
            'entrypoints_without_role_guard', (
                SELECT COALESCE(jsonb_agg(x ORDER BY x), '[]'::jsonb)
                FROM unnest(ARRAY[
                    'fn_guest_shop_create_order',
                    'fn_guest_shop_confirm_payment',
                    'fn_guest_shop_claim_fulfillment',
                    'fn_guest_shop_mark_fulfilled',
                    'fn_guest_shop_release_reservation',
                    'fn_guest_shop_list_delivered_content',
                    'fn_guest_shop_evaluate_discount',
                    'fn_guest_shop_reserve_discount',
                    'guest_shop_reservation_rollup',
                    'guest_shop_release_held_reservations',
                    -- L1/L2 promo entry points. Each must independently refuse
                    -- a non-service_role caller, not rely on the grant layer.
                    'guest_shop_promo_gate',
                    'fn_guest_shop_return_discount_reservation',
                    'fn_guest_shop_promo_record_event',
                    'fn_guest_shop_promo_set_breaker',
                    'fn_guest_shop_promo_status'
                ]) AS x
                WHERE NOT EXISTS (
                    SELECT 1 FROM fn_code f
                    WHERE f.proname = x
                      AND position('guest_shop_require_service_role' in f.code) > 0
                )
            )
        ),
        jsonb_build_object(
            'definers_without_pinned_search_path', '[]'::jsonb,
            'entrypoints_without_role_guard', '[]'::jsonb
        )
    UNION ALL
    SELECT
        12,
        'zero_purchase_guards',
        jsonb_build_object(
            -- L2 zero-purchase defence, mapped to the function that actually
            -- holds each guard. fn_guest_shop_evaluate_discount is the pure
            -- reader that calls the SHARED resolver; fn_guest_shop_reserve_discount
            -- is the writer that re-asserts the same invariants and pins the
            -- snapshot. Attributing a marker to the wrong function would make
            -- this check pass while the real guard sat elsewhere, so each key
            -- names its true owner.
            --
            -- The shared engine can zero out a total when a marketing code sets
            -- allow_zero_total. Guests pay CASH, so evaluate must call the shared
            -- resolver with that flag hard-wired to false (4th positional arg).
            'evaluate_calls_resolver_zero_false', EXISTS (
                SELECT 1 FROM fn_code
                WHERE proname = 'fn_guest_shop_evaluate_discount'
                  AND position('fn_resolve_shop_discount_amount' in code) > 0
                  AND code ~ 'fn_resolve_shop_discount_amount\s*\([^)]*?,\s*false\s*,'
            ),
            -- evaluate computes the 50% floor and rejects anything below it with
            -- guest_discount_below_floor BEFORE any reservation is written.
            'evaluate_enforces_half_floor', EXISTS (
                SELECT 1 FROM fn_code
                WHERE proname = 'fn_guest_shop_evaluate_discount'
                  AND position('ROUND(v_list_amount * 0.5, 2)' in code) > 0
                  AND position('guest_discount_below_floor' in code) > 0
            ),
            -- evaluate must be read-only: no INSERT/UPDATE/DELETE/TRUNCATE. Only
            -- reserve may write the ledger, so a preview can never mutate state.
            -- Scanned over fn_code (comments stripped), NOT raw prosrc: this
            -- function's rationale comment contains the word UPDATE and the raw
            -- scan reported a false FAIL on 2026-09-23 (header rule 3).
            'evaluate_is_read_only', NOT EXISTS (
                SELECT 1 FROM fn_code
                WHERE proname = 'fn_guest_shop_evaluate_discount'
                  AND code ~* '\mINSERT\y|\mUPDATE\y|\mDELETE\y|\mTRUNCATE\y'
            ),
            -- Read-only also means "no dynamic SQL": EXECUTE could smuggle a
            -- write past any keyword scan, so its absence is asserted separately
            -- instead of being implied by the strip above.
            'evaluate_has_no_dynamic_sql', NOT EXISTS (
                SELECT 1 FROM fn_code
                WHERE proname = 'fn_guest_shop_evaluate_discount'
                  AND code ~* '\mEXECUTE\y'
            ),
            -- Fail-closed guard on the strip itself. If the comment-stripping
            -- regexp ever ate the body, the two keys above would turn true for
            -- the WRONG reason, so require two markers that are certainly
            -- executable code in this function to survive the strip.
            'evaluate_strip_keeps_guards', EXISTS (
                SELECT 1 FROM fn_code
                WHERE proname = 'fn_guest_shop_evaluate_discount'
                  AND position('guest_shop_require_service_role' in code) > 0
                  AND position('fn_resolve_shop_discount_amount' in code) > 0
            ),
            -- reserve delegates pricing to evaluate (single source of truth) and
            -- then RE-ASSERTS the half-of-list floor itself, raising
            -- guest_discount_amount_invalid if the net came back too low. Defence
            -- in depth: even a buggy evaluate cannot push a sub-floor amount in.
            'reserve_delegates_to_evaluate', EXISTS (
                SELECT 1 FROM fn_code
                WHERE proname = 'fn_guest_shop_reserve_discount'
                  AND position('fn_guest_shop_evaluate_discount' in code) > 0
            ),
            'reserve_reasserts_half_floor', EXISTS (
                SELECT 1 FROM fn_code
                WHERE proname = 'fn_guest_shop_reserve_discount'
                  AND position('ROUND(v_list_amount * 0.5, 2)' in code) > 0
                  AND position('guest_discount_amount_invalid' in code) > 0
            ),
            -- The persisted snapshot records allow_zero_total_used=false so an
            -- auditor can prove after the fact that no guest order was zeroed.
            'reserve_snapshot_pins_zero_false', EXISTS (
                SELECT 1 FROM fn_code
                WHERE proname = 'fn_guest_shop_reserve_discount'
                  AND position('allow_zero_total_used'', false' in code) > 0
            ),
            -- A discount with no resolved credential group has nothing to count
            -- against, so it must be REFUSED, not applied unattributably. That
            -- is exactly the "被刷" scenario the ledger exists to prevent.
            'create_requires_identity_for_discount', EXISTS (
                SELECT 1 FROM fn_code
                WHERE proname = 'fn_guest_shop_create_order'
                  AND position('guest_discount_identity_required' in code) > 0
            ),
            'create_bounds_quantity_1_to_5', EXISTS (
                SELECT 1 FROM fn_code
                WHERE proname = 'fn_guest_shop_create_order'
                  AND position('guest_invalid_quantity' in code) > 0
            ),
            -- The effective ceiling must be LEAST(hard 5, guest ceiling, general
            -- per-order ceiling): an anonymous buyer may never buy more per
            -- order than a logged-in buyer could, even if the guest ceiling is
            -- misconfigured upwards.
            'create_caps_by_all_three_ceilings', EXISTS (
                SELECT 1 FROM fn_code
                WHERE proname = 'fn_guest_shop_create_order'
                  AND position('guest_quantity_not_allowed' in code) > 0
                  AND position('guest_max_quantity' in code) > 0
                  AND position('max_purchase_quantity' in code) > 0
            ),
            -- Multi-unit stock is all-or-nothing: claimed with LIMIT v_quantity
            -- under FOR UPDATE SKIP LOCKED, then length-checked against the
            -- request. Dropping either the LIMIT or the length check would let a
            -- short-stock order through with cards nobody holds.
            'create_reserves_all_or_nothing', EXISTS (
                SELECT 1 FROM fn_code
                WHERE proname = 'fn_guest_shop_create_order'
                  AND position('guest_inventory_unavailable' in code) > 0
                  AND position('LIMIT v_quantity' in code) > 0
                  AND position('FOR UPDATE SKIP LOCKED' in code) > 0
            ),
            -- Shared/reusable inventory must never be handed to a guest cash
            -- order, and the same physical card must never appear twice on one
            -- order even if a future source-chain change allowed it.
            'create_never_reserves_shared_or_duplicate_rows', EXISTS (
                SELECT 1 FROM fn_code
                WHERE proname = 'fn_guest_shop_create_order'
                  AND position('COALESCE(i.is_shared, false) = false' in code) > 0
                  AND position('COUNT(DISTINCT x)' in code) > 0
            ),
            -- Fulfilment lifecycle guards, each attributed to its real owner.
            -- confirm aggregates EVERY reservation via the rollup so a 3-card
            -- order cannot be confirmed while two cards are still merely held.
            'confirm_is_aggregate_aware', EXISTS (
                SELECT 1 FROM fn_code
                WHERE proname = 'fn_guest_shop_confirm_payment'
                  AND position('guest_shop_reservation_rollup' in code) > 0
            ),
            -- claim re-checks the rollup AND refuses to hand over cards unless
            -- payment is finally successful (guest_payment_not_fulfillable).
            'claim_is_aggregate_aware', EXISTS (
                SELECT 1 FROM fn_code
                WHERE proname = 'fn_guest_shop_claim_fulfillment'
                  AND position('guest_shop_reservation_rollup' in code) > 0
                  AND position('guest_payment_not_fulfillable' in code) > 0
            ),
            -- mark_fulfilled flips the order only when every reserved row is
            -- consumed; guest_reservation_not_consumed is that all-rows guard.
            'mark_needs_all_rows_consumed', EXISTS (
                SELECT 1 FROM fn_code
                WHERE proname = 'fn_guest_shop_mark_fulfilled'
                  AND position('guest_reservation_not_consumed' in code) > 0
            ),
            -- list_delivered_content is the card-content reveal; it must refuse
            -- unless the order is delivered AND no reservation is unconsumed.
            'delivered_content_guards_state', EXISTS (
                SELECT 1 FROM fn_code
                WHERE proname = 'fn_guest_shop_list_delivered_content'
                  AND position('guest_order_not_delivered' in code) > 0
                  AND position('guest_reservation_not_consumed' in code) > 0
            )
        ),
        jsonb_build_object(
            'evaluate_calls_resolver_zero_false', true,
            'evaluate_enforces_half_floor', true,
            'evaluate_is_read_only', true,
            'evaluate_has_no_dynamic_sql', true,
            'evaluate_strip_keeps_guards', true,
            'reserve_delegates_to_evaluate', true,
            'reserve_reasserts_half_floor', true,
            'reserve_snapshot_pins_zero_false', true,
            'create_requires_identity_for_discount', true,
            'create_bounds_quantity_1_to_5', true,
            'create_caps_by_all_three_ceilings', true,
            'create_reserves_all_or_nothing', true,
            'create_never_reserves_shared_or_duplicate_rows', true,
            'confirm_is_aggregate_aware', true,
            'claim_is_aggregate_aware', true,
            'mark_needs_all_rows_consumed', true,
            'delivered_content_guards_state', true
        )
    UNION ALL
    SELECT
        13,
        'resolver_tier_flash_parity',
        jsonb_build_object(
            -- L1 parity: the guest channel must resolve tiered prices and flash
            -- sales from the SAME catalogue inputs as the logged-in channel.
            -- Pinning quantity to 1 here would silently disable both for guests.
            'quantity_is_a_real_input', EXISTS (
                SELECT 1 FROM fn_code p
                WHERE p.proname = 'guest_shop_resolve_credit_unit_amount'
                  AND p.pronargs = 14
                  AND position('p_quantity >= v_rule_qty' in p.code) > 0
            ),
            'flash_sale_wins_over_tier', EXISTS (
                SELECT 1 FROM fn_code p
                WHERE p.proname = 'guest_shop_resolve_credit_unit_amount'
                  AND position('LEAST(v_base, v_flash_price)' in p.code) > 0
            ),
            'cheapest_satisfied_tier_wins', EXISTS (
                SELECT 1 FROM fn_code p
                WHERE p.proname = 'guest_shop_resolve_credit_unit_amount'
                  AND position('v_rule_price < v_base' in p.code) > 0
            ),
            -- The resolver returns a UNIT price. A non-positive or NaN result
            -- must come back as NULL so the caller fails closed instead of
            -- writing a zero-amount order.
            'never_returns_non_positive', EXISTS (
                SELECT 1 FROM fn_code p
                WHERE p.proname = 'guest_shop_resolve_credit_unit_amount'
                  AND position('v_result <= 0' in p.code) > 0
                  AND position('''nan''' in p.code) > 0
            ),
            'no_stale_single_overload', (
                SELECT COUNT(*) FROM fn_code p
                WHERE p.proname = 'guest_shop_resolve_credit_unit_amount'
            )
        ),
        jsonb_build_object(
            'quantity_is_a_real_input', true,
            'flash_sale_wins_over_tier', true,
            'cheapest_satisfied_tier_wins', true,
            'never_returns_non_positive', true,
            'no_stale_single_overload', 1
        )
    UNION ALL
    SELECT
        14,
        'replay_return_types_cast',
        jsonb_build_object(
            -- REGRESSION GUARD. guest_shop_orders.discount_code is VARCHAR(64)
            -- while fn_guest_shop_create_order's RETURNS TABLE declares TEXT.
            -- plpgsql matches a RETURN QUERY row type to the function result
            -- type by type OID, and varchar/text are distinct OIDs even though
            -- they are binary coercible, so an uncast column makes EVERY
            -- idempotent replay die with "structure of query does not match
            -- function result type" - i.e. every guest checkout retry 500s.
            -- site and currency are varchar for the same reason and were
            -- already cast; discount_code must be too.
            'discount_code_cast_to_text', EXISTS (
                SELECT 1 FROM fn_code
                WHERE proname = 'fn_guest_shop_create_order'
                  AND position('v_existing.discount_code::TEXT' in code) > 0
            ),
            'site_cast_to_text', EXISTS (
                SELECT 1 FROM fn_code
                WHERE proname = 'fn_guest_shop_create_order'
                  AND position('v_existing.site::TEXT' in code) > 0
            ),
            'currency_cast_to_text', EXISTS (
                SELECT 1 FROM fn_code
                WHERE proname = 'fn_guest_shop_create_order'
                  AND position('v_existing.currency::TEXT' in code) > 0
            ),
            -- The replay must also return the LIST price and the discount, not
            -- just the net, otherwise a retry shows a different price than the
            -- first attempt and the buyer-facing total appears to move.
            'replay_returns_list_and_discount', EXISTS (
                SELECT 1 FROM fn_code
                WHERE proname = 'fn_guest_shop_create_order'
                  AND position('v_existing.list_unit_amount' in code) > 0
                  AND position('v_existing.discount_amount' in code) > 0
            ),
            -- A replay under a different fingerprint or claim secret is an
            -- attack on somebody else's idempotency key, not a retry.
            'replay_guards_fingerprint_and_claim_secret', EXISTS (
                SELECT 1 FROM fn_code
                WHERE proname = 'fn_guest_shop_create_order'
                  AND position('guest_idempotency_conflict' in code) > 0
                  AND position('guest_idempotency_claim_secret_conflict' in code) > 0
            )
        ),
        jsonb_build_object(
            'discount_code_cast_to_text', true,
            'site_cast_to_text', true,
            'currency_cast_to_text', true,
            'replay_returns_list_and_discount', true,
            'replay_guards_fingerprint_and_claim_secret', true
        )
    UNION ALL
    SELECT
        15,
        'existing_rows_satisfy_new_checks',
        jsonb_build_object(
            -- The CHECK swap is only safe without a backfill if every row that
            -- already exists satisfies the new expression. P0 rows are all
            -- quantity = 1 with total = unit + 0, so these must be zero.
            'amount_check_violations', (
                SELECT COUNT(*) FROM public.guest_shop_orders o
                WHERE NOT (
                    o.unit_amount > 0
                    AND o.total_amount > 0
                    AND COALESCE(o.payment_fee_amount, 0) >= 0
                    AND COALESCE(o.discount_amount, 0) >= 0
                    AND (o.list_unit_amount IS NULL OR o.list_unit_amount > 0)
                    AND (COALESCE(o.discount_amount, 0) = 0 OR o.list_unit_amount IS NOT NULL)
                    AND (
                        o.list_unit_amount IS NULL
                        OR (
                            COALESCE(o.discount_amount, 0) < ROUND(o.list_unit_amount * o.quantity, 2)
                            AND COALESCE(o.discount_amount, 0) <= ROUND(o.list_unit_amount * o.quantity * 0.5, 2)
                        )
                    )
                    AND COALESCE(o.payment_fee_amount, 0) <= ROUND(o.unit_amount * o.quantity * 0.1, 2) + 0.01
                    AND o.total_amount = o.unit_amount * o.quantity + COALESCE(o.payment_fee_amount, 0)
                )
            ),
            'quantity_out_of_bounds', (
                SELECT COUNT(*) FROM public.guest_shop_orders
                WHERE quantity < 1 OR quantity > 5
            ),
            'negative_or_null_discount_amount', (
                SELECT COUNT(*) FROM public.guest_shop_orders
                WHERE discount_amount IS NULL OR discount_amount < 0
            ),
            'legacy_orders_kept_quantity_one', (
                SELECT COUNT(*) FROM public.guest_shop_orders
                WHERE list_unit_amount IS NULL AND quantity <> 1
            ),
            -- Nothing is enabled by this migration.
            'ledger_rows', (
                SELECT COUNT(*) FROM public.guest_shop_discount_redemptions
            ),
            'orders_carrying_a_code', (
                SELECT COUNT(*) FROM public.guest_shop_orders WHERE discount_code IS NOT NULL
            )
        ),
        jsonb_build_object(
            'amount_check_violations', 0,
            'quantity_out_of_bounds', 0,
            'negative_or_null_discount_amount', 0,
            'legacy_orders_kept_quantity_one', 0,
            'ledger_rows', 0,
            'orders_carrying_a_code', 0
        )
    UNION ALL
    SELECT
        16,
        'no_side_effects',
        jsonb_build_object(
            'no_trigger_on_orders', NOT EXISTS (
                SELECT 1 FROM pg_trigger t
                WHERE t.tgrelid = to_regclass('public.guest_shop_orders')
                  AND NOT t.tgisinternal
            ),
            -- The P0 validation trigger on the reservation table is a security
            -- control, not cruft: it must SURVIVE the widening from one row per
            -- order to N rows per order. Asserting "no triggers" here would
            -- have been wrong and would have hidden its removal.
            'reservation_validation_trigger_intact', EXISTS (
                SELECT 1 FROM pg_trigger t
                JOIN pg_proc f ON f.oid = t.tgfoid
                WHERE t.tgrelid = to_regclass('public.guest_shop_inventory_reservations')
                  AND NOT t.tgisinternal
                  AND f.proname = 'guest_shop_validate_inventory_reservation'
            ),
            'no_trigger_on_ledger', NOT EXISTS (
                SELECT 1 FROM pg_trigger t
                WHERE t.tgrelid = to_regclass('public.guest_shop_discount_redemptions')
                  AND NOT t.tgisinternal
            ),
            -- The four P0 admin policies are SELECT-only for authenticated.
            -- Adding an INSERT/UPDATE/DELETE (or ALL) policy on any guest-shop
            -- table would let a browser write money columns directly and bypass
            -- every function in this file, so assert the command set instead of
            -- the policy count.
            'writable_browser_policies', (
                SELECT COALESCE(jsonb_agg(tablename || '/' || policyname || '/' || cmd ORDER BY 1), '[]'::jsonb)
                FROM pg_policies
                WHERE schemaname = 'public'
                  AND tablename LIKE 'guest_shop%'
                  AND UPPER(cmd) <> 'SELECT'
            ),
            'ledger_has_no_policy', NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE schemaname = 'public'
                  AND tablename = 'guest_shop_discount_redemptions'
            ),
            -- The shared logged-in discount engine must not have been touched:
            -- guest parity is achieved by CALLING it, never by editing it.
            'shared_discount_engine_untouched', EXISTS (
                SELECT 1 FROM pg_proc p
                WHERE p.pronamespace = 'public'::regnamespace
                  AND p.proname = 'fn_resolve_shop_discount_amount'
                  AND p.pronargs = 7
            ),
            -- REPLACES the retired 'guest_products_enabled' = 0 expectation,
            -- which pinned OPERATOR STATE to a constant and therefore FAILed on a
            -- correct migration whenever an operator had opened a product to
            -- guest checkout (header rule 4). The live counts moved to row 23
            -- (REVIEW). What stays here is the MECHANISM this migration is
            -- actually responsible for: the guest switch must be unreachable from
            -- any guest_shop function, so no RPC (however it is called) can
            -- flip allow_guest_purchase on a product or a SKU.
            -- Comment-stripped scan; static replay of all 53 guest_shop bodies in
            -- this repository returns 0 hits. If a future batch legitimately
            -- needs an admin RPC that writes the catalogue, this key MUST be
            -- re-scoped in the same commit and reviewed, not deleted.
            'promo_functions_never_write_products', NOT EXISTS (
                SELECT 1 FROM fn_code
                WHERE code ~* '\m(INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+(ONLY\s+)?(TABLE\s+)?(public\.)?(shop_products|shop_product_skus)\y'
            )
        ),
        jsonb_build_object(
            'no_trigger_on_orders', true,
            'reservation_validation_trigger_intact', true,
            'no_trigger_on_ledger', true,
            'writable_browser_policies', '[]'::jsonb,
            'ledger_has_no_policy', true,
            'shared_discount_engine_untouched', true,
            'promo_functions_never_write_products', true
        )
    UNION ALL
    SELECT
        17,
        'discount_codes_guest_columns',
        jsonb_build_object(
            'missing_columns', (
                SELECT COALESCE(jsonb_agg(x ORDER BY x), '[]'::jsonb)
                FROM unnest(ARRAY[
                    'allow_guest', 'guest_max_uses', 'guest_used_count',
                    'guest_max_total_discount', 'guest_discount_total'
                ]) AS x
                WHERE NOT EXISTS (
                    SELECT 1 FROM information_schema.columns c
                    WHERE c.table_schema = 'public' AND c.table_name = 'discount_codes'
                      AND c.column_name = x
                )
            ),
            'caps_check_present', EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conrelid = 'public.discount_codes'::regclass
                  AND conname = 'discount_codes_guest_caps_check'
            ),
            -- allow_guest must default to false: a code is closed to guests
            -- until an operator explicitly opens it (plan §13 layer 2).
            'allow_guest_default_false', (
                SELECT COALESCE(column_default, '') = 'false'
                FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'discount_codes'
                  AND column_name = 'allow_guest'
            ),
            -- guest_max_uses defaults to 0, and 0 means CLOSED (not unlimited).
            'guest_max_uses_default_zero', (
                SELECT COALESCE(column_default, '') IN ('0', '0::integer')
                FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'discount_codes'
                  AND column_name = 'guest_max_uses'
            )
        ),
        jsonb_build_object(
            'missing_columns', '[]'::jsonb,
            'caps_check_present', true,
            'allow_guest_default_false', true,
            'guest_max_uses_default_zero', true
        )
    UNION ALL
    SELECT
        18,
        'promo_budget_table',
        jsonb_build_object(
            'table_present', to_regclass('public.guest_shop_promo_budget') IS NOT NULL,
            'missing_columns', (
                SELECT COALESCE(jsonb_agg(x ORDER BY x), '[]'::jsonb)
                FROM unnest(ARRAY['site','enabled','daily_budget_cny','budget_date','spent_cny','updated_at']) AS x
                WHERE NOT EXISTS (
                    SELECT 1 FROM information_schema.columns c
                    WHERE c.table_schema = 'public' AND c.table_name = 'guest_shop_promo_budget'
                      AND c.column_name = x
                )
            ),
            'site_check', EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.guest_shop_promo_budget'::regclass AND conname='guest_shop_promo_budget_site_check'),
            'amount_check', EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.guest_shop_promo_budget'::regclass AND conname='guest_shop_promo_budget_amount_check'),
            'rls_enabled', COALESCE((SELECT c.relrowsecurity FROM pg_class c WHERE c.oid=to_regclass('public.guest_shop_promo_budget')), false),
            'anon_grants', (SELECT COUNT(*) FROM information_schema.role_table_grants g WHERE g.table_schema='public' AND g.table_name='guest_shop_promo_budget' AND g.grantee='anon'),
            'authenticated_grants', (SELECT COUNT(*) FROM information_schema.role_table_grants g WHERE g.table_schema='public' AND g.table_name='guest_shop_promo_budget' AND g.grantee='authenticated'),
            'public_grants', (SELECT COUNT(*) FROM information_schema.role_table_grants g WHERE g.table_schema='public' AND g.table_name='guest_shop_promo_budget' AND g.grantee='PUBLIC'),
            'service_role_grants', EXISTS (SELECT 1 FROM information_schema.role_table_grants g WHERE g.table_schema='public' AND g.table_name='guest_shop_promo_budget' AND g.grantee='service_role'),
            'no_policies', NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='guest_shop_promo_budget'),
            -- Seeded closed: enabled=false, daily=0 for both sites. A deploy
            -- must never open the budget; that is a separate operator step.
            'seeded_closed_sites', (
                SELECT COUNT(*) FROM public.guest_shop_promo_budget
                WHERE site IN ('cn','intl') AND enabled = false AND daily_budget_cny = 0
            )
        ),
        jsonb_build_object(
            'table_present', true,
            'missing_columns', '[]'::jsonb,
            'site_check', true,
            'amount_check', true,
            'rls_enabled', true,
            'anon_grants', 0,
            'authenticated_grants', 0,
            'public_grants', 0,
            'service_role_grants', true,
            'no_policies', true,
            'seeded_closed_sites', 2
        )
    UNION ALL
    SELECT
        19,
        'promo_breaker_table',
        jsonb_build_object(
            'table_present', to_regclass('public.guest_shop_promo_breaker') IS NOT NULL,
            'missing_columns', (
                SELECT COALESCE(jsonb_agg(x ORDER BY x), '[]'::jsonb)
                FROM unnest(ARRAY['id','state','reason','opened_at','opened_by','closed_at','closed_by','mismatch_trip_threshold','identity_trip_threshold','trip_window_seconds','updated_at']) AS x
                WHERE NOT EXISTS (
                    SELECT 1 FROM information_schema.columns c
                    WHERE c.table_schema='public' AND c.table_name='guest_shop_promo_breaker' AND c.column_name=x
                )
            ),
            'singleton_check', EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.guest_shop_promo_breaker'::regclass AND conname='guest_shop_promo_breaker_singleton_check'),
            'state_check', EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.guest_shop_promo_breaker'::regclass AND conname='guest_shop_promo_breaker_state_check'),
            'state_exclusive_check', EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.guest_shop_promo_breaker'::regclass AND conname='guest_shop_promo_breaker_state_exclusive_check'),
            'threshold_check', EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.guest_shop_promo_breaker'::regclass AND conname='guest_shop_promo_breaker_threshold_check'),
            'rls_enabled', COALESCE((SELECT c.relrowsecurity FROM pg_class c WHERE c.oid=to_regclass('public.guest_shop_promo_breaker')), false),
            'anon_grants', (SELECT COUNT(*) FROM information_schema.role_table_grants g WHERE g.table_schema='public' AND g.table_name='guest_shop_promo_breaker' AND g.grantee='anon'),
            'service_role_grants', EXISTS (SELECT 1 FROM information_schema.role_table_grants g WHERE g.table_schema='public' AND g.table_name='guest_shop_promo_breaker' AND g.grantee='service_role'),
            'no_policies', NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='guest_shop_promo_breaker'),
            -- Seeded singleton, closed, with the documented thresholds.
            'seeded_closed_singleton', (
                SELECT COUNT(*) FROM public.guest_shop_promo_breaker
                WHERE id = 1 AND state = 'closed' AND opened_at IS NULL AND opened_by IS NULL
                  AND mismatch_trip_threshold = 3 AND identity_trip_threshold = 20 AND trip_window_seconds = 900
            )
        ),
        jsonb_build_object(
            'table_present', true,
            'missing_columns', '[]'::jsonb,
            'singleton_check', true,
            'state_check', true,
            'state_exclusive_check', true,
            'threshold_check', true,
            'rls_enabled', true,
            'anon_grants', 0,
            'service_role_grants', true,
            'no_policies', true,
            'seeded_closed_singleton', 1
        )
    UNION ALL
    SELECT
        20,
        'promo_breaker_events_table',
        jsonb_build_object(
            'table_present', to_regclass('public.guest_shop_promo_breaker_events') IS NOT NULL,
            'missing_columns', (
                SELECT COALESCE(jsonb_agg(x ORDER BY x), '[]'::jsonb)
                FROM unnest(ARRAY['id','kind','site','detail','occurred_at']) AS x
                WHERE NOT EXISTS (
                    SELECT 1 FROM information_schema.columns c
                    WHERE c.table_schema='public' AND c.table_name='guest_shop_promo_breaker_events' AND c.column_name=x
                )
            ),
            'kind_check', EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.guest_shop_promo_breaker_events'::regclass AND conname='guest_shop_promo_breaker_events_kind_check'),
            'site_check', EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.guest_shop_promo_breaker_events'::regclass AND conname='guest_shop_promo_breaker_events_site_check'),
            'detail_shape_check', EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.guest_shop_promo_breaker_events'::regclass AND conname='guest_shop_promo_breaker_events_detail_shape_check'),
            -- The no-secrets CHECK is what stops an operator/bug from logging
            -- an email, a contact hash or card content into the audit trail.
            'detail_no_secrets_check', EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.guest_shop_promo_breaker_events'::regclass AND conname='guest_shop_promo_breaker_events_detail_no_secrets_check'),
            'window_index', EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='guest_shop_promo_breaker_events' AND indexname='idx_guest_shop_promo_breaker_events_window'),
            'rls_enabled', COALESCE((SELECT c.relrowsecurity FROM pg_class c WHERE c.oid=to_regclass('public.guest_shop_promo_breaker_events')), false),
            'anon_grants', (SELECT COUNT(*) FROM information_schema.role_table_grants g WHERE g.table_schema='public' AND g.table_name='guest_shop_promo_breaker_events' AND g.grantee='anon'),
            'service_role_grants', EXISTS (SELECT 1 FROM information_schema.role_table_grants g WHERE g.table_schema='public' AND g.table_name='guest_shop_promo_breaker_events' AND g.grantee='service_role'),
            'no_policies', NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='guest_shop_promo_breaker_events')
        ),
        jsonb_build_object(
            'table_present', true,
            'missing_columns', '[]'::jsonb,
            'kind_check', true,
            'site_check', true,
            'detail_shape_check', true,
            'detail_no_secrets_check', true,
            'window_index', true,
            'rls_enabled', true,
            'anon_grants', 0,
            'service_role_grants', true,
            'no_policies', true
        )
    UNION ALL
    SELECT
        21,
        'ledger_return_columns',
        jsonb_build_object(
            'missing_columns', (
                SELECT COALESCE(jsonb_agg(x ORDER BY x), '[]'::jsonb)
                FROM unnest(ARRAY['returned_at','return_reason']) AS x
                WHERE NOT EXISTS (
                    SELECT 1 FROM information_schema.columns c
                    WHERE c.table_schema='public' AND c.table_name='guest_shop_discount_redemptions' AND c.column_name=x
                )
            ),
            -- returned_at and return_reason must be set together or not at all:
            -- the idempotent return claim flips both in one UPDATE.
            'return_check', EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.guest_shop_discount_redemptions'::regclass AND conname='guest_shop_discount_redemptions_return_check'),
            'unreturned_index', EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='guest_shop_discount_redemptions' AND indexname='idx_guest_shop_discount_redemptions_unreturned')
        ),
        jsonb_build_object(
            'missing_columns', '[]'::jsonb,
            'return_check', true,
            'unreturned_index', true
        )
    UNION ALL
    SELECT
        22,
        'promo_function_guards',
        jsonb_build_object(
            -- The guest whitelist + quota gate must actually be inside evaluate.
            'evaluate_has_allow_guest_guard', EXISTS (SELECT 1 FROM fn_code p WHERE p.proname='fn_guest_shop_evaluate_discount' AND position('allow_guest' in p.code)>0 AND position('guest_max_uses' in p.code)>0),
            -- reserve must atomically touch the budget table and increment the
            -- guest counters; without these the caps are advisory only.
            'reserve_has_budget_and_counters', EXISTS (SELECT 1 FROM fn_code p WHERE p.proname='fn_guest_shop_reserve_discount' AND position('guest_shop_promo_budget' in p.code)>0 AND position('guest_used_count' in p.code)>0),
            'gate_has_budget_exhausted', EXISTS (SELECT 1 FROM fn_code p WHERE p.proname='guest_shop_promo_gate' AND position('guest_promo_budget_exhausted' in p.code)>0),
            'return_claims_ledger', EXISTS (SELECT 1 FROM fn_code p WHERE p.proname='fn_guest_shop_return_discount_reservation' AND position('returned_at' in p.code)>0),
            'record_event_auto_trips', EXISTS (SELECT 1 FROM fn_code p WHERE p.proname='fn_guest_shop_promo_record_event' AND position('auto_open' in p.code)>0),
            'set_breaker_requires_actor', EXISTS (SELECT 1 FROM fn_code p WHERE p.proname='fn_guest_shop_promo_set_breaker' AND position('actor' in p.code)>0),
            'status_exposes_budgets', EXISTS (SELECT 1 FROM fn_code p WHERE p.proname='fn_guest_shop_promo_status' AND position('budgets' in p.code)>0)
        ),
        jsonb_build_object(
            'evaluate_has_allow_guest_guard', true,
            'reserve_has_budget_and_counters', true,
            'gate_has_budget_exhausted', true,
            'return_claims_ledger', true,
            'record_event_auto_trips', true,
            'set_breaker_requires_actor', true,
            'status_exposes_budgets', true
        )
    UNION ALL
    SELECT
        23,
        'operator_state_review',
        jsonb_build_object(
            -- OPERATOR STATE, DELIBERATELY NOT A PASS/FAIL CONSTANT.
            -- This row answers the question the retired row-16 key tried to
            -- answer with a pinned 0: "is anything open to guest checkout right
            -- now, and did a human decide that?" No migration can decide it, so
            -- the answer is REVIEW until an operator confirms it. The convention
            -- (PASS while nothing is open, REVIEW otherwise, and REVIEW is not a
            -- failure) is the one already used by row 8 of
            -- 20260915_verify_guest_shop_credit_pricing.sql.
            --
            -- The identity list exists because a bare count cannot be acted on:
            -- the 2026-09-23 first run reported 2 guest-enabled products while
            -- docs/guest-purchase-task-2.0.md records ONE product opened for
            -- testing plus the standing rule not to open a second. Naming the
            -- products is what lets an operator settle that in one look.
            'guest_products_enabled', (
                SELECT COUNT(*) FROM public.shop_products
                WHERE COALESCE(allow_guest_purchase, false)
            ),
            'guest_skus_enabled', (
                SELECT COUNT(*) FROM public.shop_product_skus
                WHERE COALESCE(allow_guest_purchase, false)
            ),
            -- L2 opens discount_codes.allow_guest; a code left open to guests is
            -- live spend authority, so it belongs in the same operator review.
            'guest_discount_codes_open', (
                SELECT COUNT(*) FROM public.discount_codes
                WHERE COALESCE(allow_guest, false)
            ),
            'guest_enabled_products', (
                SELECT COALESCE(jsonb_agg(
                           jsonb_build_object(
                               'id', p.id,
                               'name', p.name,
                               'is_active', p.is_active,
                               'guest_skus', (
                                   SELECT COUNT(*) FROM public.shop_product_skus s
                                   WHERE s.product_id = p.id
                                     AND COALESCE(s.allow_guest_purchase, false)
                               )
                           ) ORDER BY p.name, p.id
                       ), '[]'::jsonb)
                FROM public.shop_products p
                WHERE COALESCE(p.allow_guest_purchase, false)
            )
        ),
        to_jsonb(
            'informational operator state; do not enable products or codes from SQL. '
            || 'Confirm every listed product / SKU / discount code is open to guest checkout on purpose, '
            || 'and close anything unintended in Admin Studio. REVIEW is not a migration failure.'::TEXT
        )
)
SELECT
    sort_order,
    check_name,
    observed,
    expected,
    CASE
        -- Row 23 reports OPERATOR STATE, so it can never be graded against a
        -- pinned constant. PASS while nothing is open to guests, REVIEW as soon
        -- as a human has to confirm intent, and never FAIL: a FAIL here would
        -- train operators to ignore FAILs everywhere else in this report.
        WHEN check_name = 'operator_state_review' THEN
            CASE
                WHEN (observed->>'guest_products_enabled')::BIGINT = 0
                 AND (observed->>'guest_skus_enabled')::BIGINT = 0
                 AND (observed->>'guest_discount_codes_open')::BIGINT = 0
                THEN 'PASS' ELSE 'REVIEW'
            END
        WHEN observed = expected THEN 'PASS'
        ELSE 'FAIL'
    END AS status
FROM checks
ORDER BY sort_order;
